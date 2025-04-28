// app/api/webhooks/route.ts

import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "octokit";
// Путь может быть другим, посмотрите ваш jsconfig/tsconfig. 
// Здесь мы берём openai из app/openai.ts
import { openai } from "../../openai"; 

const GH_OWNER = "vlaskov67";
const GH_REPO  = "vlaskov-store";
const GH_TOKEN = process.env.GITHUB_TOKEN!;

export async function POST(req: NextRequest) {
  // 1) Проверяем, что это новый issue
  const event = req.headers.get("x-github-event");
  if (event !== "issues") return NextResponse.json({ ignored: true });
  const payload = await req.json();
  if (payload.action !== "opened") return NextResponse.json({ skipped: true });

  const title       = payload.issue.title;
  const body        = payload.issue.body || "";
  const issueNumber = payload.issue.number;
  console.log("📥 Новая задача:", title);

  const octokit = new Octokit({ auth: GH_TOKEN });

  // 2) Собираем контекст из папки docs
  let docsContent = "";
  try {
    const docsRes = await octokit.rest.repos.getContent({
      owner: GH_OWNER,
      repo: GH_REPO,
      path: "docs",
    });
    if (Array.isArray(docsRes.data)) {
      for (const file of docsRes.data) {
        if (file.download_url) {
          let txt = await fetch(file.download_url).then((r) => r.text());
          docsContent += `Файл: ${file.name}\n` +
                         `${txt.slice(0, 2000)}\n\n---\n\n`;
        }
      }
    }
  } catch (e) {
    console.warn("⚠️ Не удалось загрузить docs:", e);
  }

  // 3) Формируем prompt
  const prompt = `
Ты опытный Laravel-разработчик. Используй следующее ТЗ:

${docsContent}

Твоя задача:
${title}

${body}

Ответь СТРОГО JSON в формате:

{
  "files": [
    {
      "path": "путь/к/файлу.php",
      "content": "содержимое файла"
    }
  ]
}

Никакого текста вне JSON!
`;

  // 4) Вызываем OpenAI
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",               // <- модель из Playground
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  });

  const answer = completion.choices[0].message?.content ?? "{}";
  console.log("🛰️ OpenAI ответ:", answer);

  // 5) Парсим JSON
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

  // 7) Создаём blob’ы и дерево
  const treeItems = [];
  for (const f of files) {
    const blob = await octokit.rest.git.createBlob({
      owner: GH_OWNER,
      repo: GH_REPO,
      content: f.content,
      encoding: "utf-8",
    });
    treeItems.push({
      path: f.path.trim(),
      mode: "100644",
      type: "blob",
      sha: blob.data.sha,
    });
  }
  const tree = await octokit.rest.git.createTree({
    owner: GH_OWNER,
    repo: GH_REPO,
    base_tree: mainRef.data.object.sha,
    tree: treeItems,
  });

  // 8) Коммит и обновление ref
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
  });

  // 9) Открываем Pull Request
  await octokit.rest.pulls.create({
    owner: GH_OWNER,
    repo: GH_REPO,
    title: `auto: resolve #${issueNumber}`,
    head: branchName,
    base: "main",
    body: "🤖 Автоматически созданный PR по issue",
  });

  return NextResponse.json({ status: "PR created" });
}
