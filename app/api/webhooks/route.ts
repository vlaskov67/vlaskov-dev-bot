// app/api/webhooks/route.ts

import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "octokit";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const GH_TOKEN         = process.env.GITHUB_TOKEN!;
const GH_OWNER         = "vlaskov67";
const GH_REPO          = "vlaskov-store";

export async function POST(req: NextRequest) {
  try {
    // 1) Фильтруем только новые issues
    const event = req.headers.get("x-github-event");
    if (event !== "issues") return NextResponse.json({ ignored: true });

    const payload = await req.json();
    if (payload.action !== "opened") return NextResponse.json({ skipped: true });

    const title       = payload.issue.title;
    const body        = payload.issue.body || "";
    const issueNumber = payload.issue.number;
    console.log("📥 Новая задача:", title);

    const octokit = new Octokit({ auth: GH_TOKEN });

    // 2) Минимальный контекст (или доки при желании)
    const docsContent =
      "Это интернет-магазин на Laravel с использованием Livewire и Alpine.js.";

    // 3) Prompt
    const prompt = `
Ты опытный разработчик на Laravel, Livewire и Alpine.js. Используй следующее ТЗ:

${docsContent}

Задача: ${title}

${body}

Отвечай строго JSON-объектом:
{
  "files": [
    { "path":"backend/CartPage.php","content":"<?php …" }
  ]
}
Без комментариев или лишнего текста!
`;

    // 4) Запрос к OpenAI
    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    }).then((r) => r.json());

    const answer = completion.choices?.[0]?.message?.content ?? "{}";
    console.log("🛰️ OpenAI ответ:", answer);

    // 5) Парсинг JSON
    let files: Array<{ path: string; content: string }>;
    try {
      const parsed = JSON.parse(answer);
      if (!Array.isArray(parsed.files)) {
        throw new Error("parsed.files не массив");
      }
      files = parsed.files;
    } catch (e: any) {
      console.error("❌ Ошибка парсинга JSON:", e.message, "— ответ:", answer);
      return NextResponse.json({
        error: true,
        message: "Ошибка парсинга JSON от OpenAI: " + e.message,
      });
    }

    // 6) Создаём ветку
    const branchName = `auto/issue-${issueNumber}`;
    const mainRef    = await octokit.rest.git.getRef({
      owner: GH_OWNER,
      repo: GH_REPO,
      ref: "heads/main",
    });
    await octokit.rest.git.createRef({
      owner: GH_OWNER,
      repo: GH_REPO,
      ref:  `refs/heads/${branchName}`,
      sha:  mainRef.data.object.sha,
    });

    // 7) Формируем treeItems с литеральными типами
    const treeItems = await Promise.all(files.map(async (f) => {
      const blob = await octokit.rest.git.createBlob({
        owner:    GH_OWNER,
        repo:     GH_REPO,
        content:  f.content,
        encoding: "utf-8",
      });
      return {
        path: f.path.trim(),
        mode: "100644" as const,
        type: "blob"   as const,
        sha:  blob.data.sha,
      };
    }));

    // 8) Создаём дерево
    const tree = await octokit.rest.git.createTree({
      owner:     GH_OWNER,
      repo:      GH_REPO,
      base_tree: mainRef.data.object.sha,
      tree:      treeItems,
    });

    // 9) Коммитим и обновляем ref
    const commit = await octokit.rest.git.createCommit({
      owner:   GH_OWNER,
      repo:    GH_REPO,
      message: `auto: resolve issue #${issueNumber}`,
      tree:    tree.data.sha,
      parents: [mainRef.data.object.sha],
    });
    await octokit.rest.git.updateRef({
      owner: GH_OWNER,
      repo:  GH_REPO,
      ref:   `heads/${branchName}`,
      sha:   commit.data.sha,
      force: true,
    });

    // 10) Открываем PR
    await octokit.rest.pulls.create({
      owner: GH_OWNER,
      repo:  GH_REPO,
      title: `auto: resolve #${issueNumber}`,
      head:  branchName,
      base:  "main",
      body:  "🤖 Автоматически созданный PR по вашему issue.",
    });

    return NextResponse.json({ status: "PR created" });
  } catch (err: any) {
    console.error("❌ Ошибка в фабрике кода:", err);
    return NextResponse.json({ error: true, message: err.message });
  }
}
