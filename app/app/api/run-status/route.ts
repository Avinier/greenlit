import { NextResponse } from "next/server";

const githubApiBase = "https://api.github.com";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export async function GET() {
  try {
    const token = getRequiredEnv("GITHUB_TOKEN");
    const owner = getRequiredEnv("PLAYGROUND_OWNER");
    const repo = getRequiredEnv("PLAYGROUND_REPO");
    const workflow = getRequiredEnv("PLAYGROUND_WORKFLOW");

    const response = await fetch(
      `${githubApiBase}/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: body?.message || "Failed to load workflow runs." },
        { status: response.status }
      );
    }

    const data = (await response.json()) as {
      workflow_runs?: Array<{
        status?: string;
        conclusion?: string | null;
        html_url?: string;
      }>;
    };

    const latest = data.workflow_runs?.[0] ?? null;

    return NextResponse.json({
      status: latest?.status ?? null,
      conclusion: latest?.conclusion ?? null,
      runUrl: latest?.html_url ?? null
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected error."
      },
      { status: 500 }
    );
  }
}
