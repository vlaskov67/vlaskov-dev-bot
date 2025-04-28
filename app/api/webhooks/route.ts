// app/api/webhooks/route.ts

import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "octokit";
import { openai } from "@/app/openai";     // <-- корректный абсолютный импорт

const GH_OWNER = "vlaskov67";
const GH_REPO  = "vlaskov-store";
const GH_TOKEN = process.env.GITHUB_TOKEN!;

export async function POST(req: NextRequest) {
  // 1) Только на “opened” issue
  if (req.headers.get("x-github-event") !== "issues") {
    return NextResponse.json({ ignored: true });
  }
  const payload = await req.json();
  if (payload.action !== "opened") {
    return NextResponse.json({ skipped: true });
  }

  const title       = payload.issue.title;
  const body        = payload.issue.body || "";
  const issueNumber = payload.issue.number;
  console.log("📥 Новая задача:", title);

  const octokit = new Octokit({ auth: GH_TOKEN });

  // 2) Собираем минимум контекста
  let docsContent = "Это интернет-магазин на Laravel с Livewire и Alpine.js.";
  try {
    const docsRes = await octokit.rest.repos.getContent({
      owner: GH_OWNER,
      repo: GH_REPO,
      path: "docs",
    });
    if (Array.isArray(docsRes.data)) {
      docsContent = "";
      for (const file of docsRes.data) {
        if (file.download_url) {
          const txt = await fetch(file.download_url).then((r) => r.text());
          docsContent += `Файл: ${file.name}\n${txt.slice(0, 2000)}\n\n---\n\n`;
        }
      }
    }
  } catch {
    console.warn("⚠️ Не удалось загрузить docs — используем базовый контекст.");
  }

  // 3) Формируем prompt
  const prompt = `
Ты опытный Laravel-разработчик. Используй следующее ТЗ:

${docsContent}

Задача:
${title}

${body}

Ответь СТРОГО JSON-объектом вида:
{
  "files": [
    { "path": "backend/CartPage.php", "content": "<?php …" }
  ]
}
Без текста вне JSON.
`;

  // 4) Вызываем OpenAI
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",               // модель из Playground
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  });

  const answer = completion.choices[0].message?.content ?? "{}";
  console.log("🛰️ OpenAI ответ:", answer);

  // 5) Парсим ответ
  let files: Array<{ path: string; content: string }>;
  try {
    const parsed = JSON.parse(answer);
    if (!Array.isArray(parsed.files)) {
      throw new Error("parsed.files не массив");
    }
    files = parsed.files;
  } catch (e) {
    console.error("❌ Ошибка парсинга JSON:", e, "— ответ:", answer);
    return NextResponse.json({
      error: true,
      message: "Ошибка парсинга JSON от OpenAI: " + e.message,
    });
  }

  // 6) Создаём новую ветку
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

  // 7) Добавляем файлы в дерево
  const treeItems = await Promise.all(files.map(async (f) => {
    const blob = await octokit.rest.git.createBlob({
      owner:   GH_OWNER,
      repo:    GH_REPO,
      content: f.content,
      encoding: "utf-8",
    });
    return {
      path: f.path.trim(),
      mode: "100644",
      type: "blob",
      sha:  blob.data.sha,
    };
  }));

  const tree = await octokit.rest.git.createTree({
    owner:     GH_OWNER,
    repo:      GH_REPO,
    base_tree: mainRef.data.object.sha,
    tree:      treeItems,
  });

  // 8) Коммит и обновление ref
  const commit = await octokit.rest.git.createCommit({
    owner:  GH_OWNER,
    repo:   GH_REPO,
    message:`auto: resolve issue #${issueNumber}`,
    tree:   tree.data.sha,
    parents:[mainRef.data.object.sha],
  });
  await octokit.rest.git.updateRef({
    owner: GH_OWNER,
    repo:  GH_REPO,
    ref:   `heads/${branchName}`,
    sha:   commit.data.sha,
    force: true,
  });

  // 9) Открываем Pull Request
  await octokit.rest.pulls.create({
    owner: GH_OWNER,
    repo:  GH_REPO,
    title:`auto: resolve #${issueNumber}`,
    head: branchName,
    base: "main",
    body: "🤖 Автоматически созданный PR по issue",
  });

  return NextResponse.json({ status: "PR created" });
}
