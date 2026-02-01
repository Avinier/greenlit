"use client";

import { useMemo, useState } from "react";

const scenarios = [
  {
    id: "test_fail",
    label: "Test Failure",
    description: "Fails a deterministic unit test."
  },
  {
    id: "lint_fail",
    label: "Lint Failure",
    description: "Triggers a lint rule violation."
  },
  {
    id: "flake",
    label: "Flaky Test",
    description: "Randomized failure to show flakiness."
  }
];

type RunDemoResponse = {
  runUrl: string | null;
  workflowUrl: string;
  failureCardUrl: string | null;
};

export default function Home() {
  const [scenario, setScenario] = useState(scenarios[0].id);
  const [status, setStatus] = useState<"idle" | "running" | "ready">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [runInfo, setRunInfo] = useState<RunDemoResponse | null>(null);

  const repoInfo = useMemo(() => {
    const owner =
      process.env.NEXT_PUBLIC_PLAYGROUND_OWNER ?? "your-org-or-user";
    const repo = process.env.NEXT_PUBLIC_PLAYGROUND_REPO ?? "greenlit-playground";
    const workflow =
      process.env.NEXT_PUBLIC_PLAYGROUND_WORKFLOW ?? "ci.yml";
    return { owner, repo, workflow };
  }, []);

  const handleRunDemo = async () => {
    setStatus("running");
    setError(null);
    setRunInfo(null);

    try {
      const response = await fetch("/api/run-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body?.error || "Failed to trigger the GitHub workflow dispatch."
        );
      }

      const data = (await response.json()) as RunDemoResponse;
      setRunInfo(data);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
      setStatus("idle");
    }
  };

  return (
    <main className="page">
      <header className="header">
        <div className="logo-mark" aria-hidden="true">
          GL
        </div>
        <div>
          <p className="eyebrow">Greenlit Playground</p>
          <h1>Run the live Failure Card demo</h1>
          <p className="subtitle">
            Trigger a real GitHub Actions failure and see Greenlit publish a
            Failure Card with routing and evidence.
          </p>
        </div>
      </header>

      <section className="card">
        <div className="section">
          <h2>Choose a scenario</h2>
          <p className="hint">
            Each scenario intentionally fails in the playground repo.
          </p>
          <div className="scenario-grid">
            {scenarios.map((item) => (
              <label
                key={item.id}
                className={`scenario ${scenario === item.id ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="scenario"
                  value={item.id}
                  checked={scenario === item.id}
                  onChange={() => setScenario(item.id)}
                />
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.description}</p>
                </div>
              </label>
            ))}
          </div>
          <button
            className="primary"
            onClick={handleRunDemo}
            disabled={status === "running"}
          >
            {status === "running" ? "Running demo…" : "Run Demo"}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </div>

        <div className="section">
          <h2>Status & links</h2>
          <p className="hint">
            The workflow runs in {repoInfo.owner}/{repoInfo.repo}. It may take a
            minute to appear.
          </p>
          <div className="link-grid">
            <a
              className="link-card"
              href={`https://github.com/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${repoInfo.workflow}`}
              target="_blank"
              rel="noreferrer"
            >
              View workflow runs
            </a>
            <a
              className="link-card"
              href={`https://github.com/${repoInfo.owner}/${repoInfo.repo}/pulls`}
              target="_blank"
              rel="noreferrer"
            >
              Find the Failure Card comment
            </a>
          </div>
          {runInfo ? (
            <div className="status-panel">
              <h3>Latest dispatch</h3>
              <p>
                Scenario: <strong>{scenario}</strong>
              </p>
              <ul>
                <li>
                  Workflow run:{" "}
                  {runInfo.runUrl ? (
                    <a href={runInfo.runUrl} target="_blank" rel="noreferrer">
                      Open run
                    </a>
                  ) : (
                    "Pending – refresh in a few seconds"
                  )}
                </li>
                <li>
                  Failure Card:{" "}
                  {runInfo.failureCardUrl ? (
                    <a
                      href={runInfo.failureCardUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View comment
                    </a>
                  ) : (
                    "Check the run output or PR comment"
                  )}
                </li>
              </ul>
            </div>
          ) : (
            <div className="status-panel muted">
              <p>No demo run yet. Click “Run Demo” to start.</p>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <h2>How it works</h2>
        <ol>
          <li>We dispatch a workflow in the playground repo.</li>
          <li>The workflow fails on purpose (test/lint/flake).</li>
          <li>Greenlit posts a Failure Card with owner routing.</li>
        </ol>
        <p className="hint">
          Configure <code>GITHUB_TOKEN</code> + playground settings in Vercel to
          make this live.
        </p>
      </section>
    </main>
  );
}
