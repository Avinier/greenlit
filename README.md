# 🤖 Greenlit

> Turn CI failures into incident cards with owner routing and memory.

<p align="center">
  <img src="greenlit-logo-1.png" alt="Greenlit" width="320" />
</p>

Greenlit is a CI incident response layer. It summarizes failing GitHub Actions runs into a **Failure Card**, assigns an owner, and links prior incidents so repeat failures get faster to resolve. Optional automation can suggest a fix or rerun, but the core product is **triage + routing + memory**.

## Features (MVP)

- Failure Card with workflow/job/step, error signature, evidence excerpt
- Owner routing with a clear “why this owner” explanation
- Signature memory (dedupe + prior outcomes)
- Policy routing: report-only vs rerun/quarantine vs escalate
- Optional automation (patch suggestion; PR creation optional)

## Quick start

```bash
npm install
npm run build
```

Create `greenlit.yml`:

```yaml
version: 1

guardrails:
  max_diff_lines: 200
  max_runtime_seconds: 300
  allowed_commands:
    - "npm test"
    - "npm run lint"
    - "npm run build"
  forbidden_patterns:
    - "*.env*"
    - "package-lock.json"

behavior:
  auto_pr: false
  require_verification: true
```

## GitHub Action setup (recommended)

`.github/workflows/greenlit.yml`

```yaml
name: Greenlit CI Triage

on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]

permissions:
  contents: write
  pull-requests: write
  actions: read

jobs:
  triage:
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
          fetch-depth: 10
      - name: Run Greenlit
        uses: avinier/greenlit@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          run-id: ${{ github.event.workflow_run.id }}
          repo: ${{ github.repository }}
          branch: ${{ github.event.workflow_run.head_branch }}
          sha: ${{ github.event.workflow_run.head_sha }}
          base-branch: ${{ github.event.workflow_run.head_branch }}
```

Required secrets: `OPENAI_API_KEY` (and `GITHUB_TOKEN` is provided by GitHub Actions).

## CLI

```bash
# Triage a failing run
node dist/index.js triage --run-id 12345 --repo owner/repo --branch main --sha abc123

# Publish an incident card (comment-only)
node dist/index.js publish --result greenlit-result.json --base-branch main --comment-only

# Local analysis
node dist/index.js analyze --command "npm test"
```

## Output

- `greenlit-result.json`
- `greenlit-result-rca.md`
- Failure Card posted as a PR comment or check output
- Optional PR creation if `behavior.auto_pr` is enabled

---

Built for the OpenAI Engineers Day Hackathon 2026.
