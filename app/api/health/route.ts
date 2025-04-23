import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "octokit";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const GH_TOKEN = process.env.GITHUB_TOKEN!;
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

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Ты помощник, который пишет pull request по описанию из GitHub Issue." },
          { role: "user", content: `Создай Pull Request в ${GH_REPO} с задачей: ${title}\n\nОписание:\n${body}` },
        ],
      }),
    }).then((res) => res.json());

    const answer = completion.choices?.[0]?.message?.content || "// пусто";
    const branchName = `auto/issue-${issueNumber}`;
    const octokit = new Octokit({ auth: GH_TOKEN });

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

    const filePath = `generated/issue-${issueNumber}.ts`;

    const blob = await octokit.rest.git.createBlob({
      owner: GH_OWNER,
      repo: GH_REPO,
      content: answer,
      encoding: "utf-8",
    });

    const tree = await octokit.rest.git.createTree({
      owner: GH_OWNER,
      repo: GH_REPO,
      base_tree: mainRef.data.object.sha,
      tree: [{ path: filePath, mode: "100644", type: "blob", sha: blob.data.sha }],
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
      body: "Этот PR сгенерирован фабрикой кода 🤖",
    });

    return NextResponse.json({ status: "PR created" });
  } catch (err) {
    console.error("❌ Ошибка в фабрике кода:", err);
    return NextResponse.json({ error: true, message: (err as Error).message });
  }
}
