import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "octokit";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = "vlaskov67";
const GH_REPO = "vlaskov-store";

export async function POST(req: NextRequest) {
  try {
    const event = req.headers.get("x-github-event");
    if (event !== "issues") return NextResponse.json({ ignored: true });

    const payload = await req.json();
    if (payload.action !== "opened") return NextResponse.json({ skipped: true });

    const title = payload.issue.title;
    const body = payload.issue.body || "";
    const issueNumber = payload.issue.number;

    console.log("📥 Новая задача:", title);

    // 1. Чтение всех документов из папки docs репозитория сайта
    const octokit = new Octokit({ auth: GH_TOKEN });
    const docsRes = await octokit.rest.repos.getContent({
      owner: GH_OWNER,
      repo: GH_REPO,
      path: "docs",
    });

    let docsContent = "";

    if (Array.isArray(docsRes.data)) {
      for (const file of docsRes.data) {
        if (file.download_url) {
          const content = await fetch(file.download_url).then((res) => res.text());
          docsContent += `Файл: ${file.name}\n${content}\n\n---\n\n`;
        }
      }
    }

    // 2. Правильный промпт для OpenAI
    const prompt = `
Ты опытный разработчик на Laravel, Livewire и Alpine.js. Используй следующее техническое задание:

${docsContent}

Твоя задача:
${title}

${body}

Создай нужные файлы и папки для реализации задачи. Ответ дай строго в формате:

путь/к/файлу.php
---
содержимое файла

Следующий файл...

Без лишних комментариев.
`;

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    }).then((res) => res.json());

    const answer = completion.choices?.[0]?.message?.content || "// пусто";
    const branchName = `auto/issue-${issueNumber}`;

    const mainRef = await octokit.rest.git.getRef({
      owner: GH_OWNER,
      repo: GH_REPO,
      ref: "heads/main",
    });

    await octokit.rest.git.createRef({
      owner: GH_OWNER,
      repo: GH_REPO,
      ref: `refs/heads/${branchName}`,
      sha: mainRef.data.object.sha,
    });

    // 3. Создание файлов и коммита
    const files = answer.split("\n\nСледующий файл...\n\n");
    const treeItems = [];

    for (const file of files) {
      const [filePath, fileContent] = file.split("\n---\n");
      const blob = await octokit.rest.git.createBlob({
        owner: GH_OWNER,
        repo: GH_REPO,
        content: fileContent,
        encoding: "utf-8",
      });

      treeItems.push({ path: filePath.trim(), mode: "100644", type: "blob", sha: blob.data.sha });
    }

    const tree = await octokit.rest.git.createTree({
      owner: GH_OWNER,
      repo: GH_REPO,
      base_tree: mainRef.data.object.sha,
      tree: treeItems,
    });

    const commit = await octokit.rest.git.createCommit({
      owner: GH_OWNER,
      repo: GH_REPO,
      message: `auto: resolve issue #${issueNumber}`,
      tree: tree.data.sha,
      parents: [mainRef.data.object.sha],
    });

    await octokit.rest.git.updateRef({
      owner: GH_OWNER,
      repo: GH_REPO,
      ref: `heads/${branchName}`,
      sha: commit.data.sha,
      force: true,
    });

    await octokit.rest.pulls.create({
      owner: GH_OWNER,
      repo: GH_REPO,
      title: `auto: resolve #${issueNumber}`,
      head: branchName,
      base: "main",
      body: "🤖 Автоматически созданный PR по вашему issue.",
    });

    return NextResponse.json({ status: "PR created" });
  } catch (err) {
    console.error("❌ Ошибка в фабрике кода:", err);
    return NextResponse.json({ error: true, message: (err as Error).message });
  }
}
