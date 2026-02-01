import { NextResponse } from "next/server";

const githubApiBase = "https://api.github.com";

const scenarios = new Set(["test_fail", "lint_fail", "flake"]);

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export async function POST(request: Request) {
  try {
    const { scenario } = (await request.json()) as { scenario?: string };

    if (!scenario || !scenarios.has(scenario)) {
      return NextResponse.json(
        { error: "Invalid scenario. Use test_fail, lint_fail, or flake." },
        { status: 400 }
      );
    }

    const token = getRequiredEnv("GITHUB_TOKEN");
    const owner = getRequiredEnv("PLAYGROUND_OWNER");
    const repo = getRequiredEnv("PLAYGROUND_REPO");
    const workflow = getRequiredEnv("PLAYGROUND_WORKFLOW");

    const dispatchResponse = await fetch(
      `${githubApiBase}/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json"
        },
        body: JSON.stringify({
          ref: "main",
          inputs: { scenario }
        })
      }
    );

    if (!dispatchResponse.ok) {
      const body = await dispatchResponse.json().catch(() => ({}));
      return NextResponse.json(
        {
          error:
            body?.message || "GitHub workflow dispatch failed. Check token."
        },
        { status: dispatchResponse.status }
      );
    }

    const workflowUrl = `https://github.com/${owner}/${repo}/actions/workflows/${workflow}`;

    const runLookup = await fetch(
      `${githubApiBase}/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    let runUrl: string | null = null;
    if (runLookup.ok) {
      const data = (await runLookup.json()) as {
        workflow_runs?: Array<{ html_url?: string }>;
      };
      runUrl = data.workflow_runs?.[0]?.html_url ?? null;
    }

    const failureCardUrl = process.env.PLAYGROUND_FAILURE_CARD_URL ?? null;

    return NextResponse.json({ runUrl, workflowUrl, failureCardUrl });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected error."
      },
      { status: 500 }
    );
  }
}
