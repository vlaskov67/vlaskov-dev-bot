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

    const octokit = new Octokit({ auth: GH_TOKEN });

    // Временный минимальный тестовый контекст
    let docsContent = "Это интернет-магазин на Laravel с использованием Livewire и Alpine.js.";

    const prompt = `
Ты опытный разработчик на Laravel, Livewire и Alpine.js. Используй следующее ТЗ:

${docsContent}

Твоя задача:
${title}

${body}

Создай нужные файлы и папки для реализации задачи.

ВАЖНО: ответ дай СТРОГО в формате JSON:

{
  "files": [
    {
      "path": "путь/к/файлу.php",
      "content": "полное содержимое файла"
    }
  ]
}

Не добавляй лишних комментариев или текста вне JSON.
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

    const answer = completion.choices?.[0]?.message?.content || "{}";
    let files;

    try {
      const parsed = JSON.parse(answer);
      if (!parsed.files || !Array.isArray(parsed.files)) {
        throw new Error("Ответ OpenAI не содержит массива files");
      }
      files = parsed.files;
    } catch (e) {
      console.error("❌ Ошибка парсинга JSON:", e.message, "Ответ OpenAI:", answer);
      return NextResponse.json({ error: true, message: "Ошибка парсинга JSON от OpenAI: " + e.message });
    }

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

    const treeItems = [];

    for (const file of files) {
      const blob = await octokit.rest.git.createBlob({
        owner: GH_OWNER,
        repo: GH_REPO,
        content: file.content,
        encoding: "utf-8",
      });

      treeItems.push({ path: file.path.trim(), mode: "100644", type: "blob", sha: blob.data.sha });
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
