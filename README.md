# 🤖 Greenlit

> **Turn red CI runs into verified green PRs in one agent loop.**

Greenlit is an agentic CI failure triage tool that automatically diagnoses failing CI runs, generates minimal fixes, and opens verified PRs with root cause analysis.

![Greenlit Flow](greenlit-logo-1.png)

## ✨ Features

- **Auto-trigger on CI failures** - Runs when GitHub Actions workflow fails
- **Smart classification** - Identifies test/lint/build/typecheck failures vs infra/secrets issues
- **Minimal patches** - Generates surgical fixes (<200 lines changed)
- **Verification loop** - Re-runs failing commands to prove the fix works
- **Auto-PR with RCA** - Opens PR with root cause analysis and evidence

## 🚀 Quick Start

### Installation

```bash
npm install
npm run build
```

### Configuration

Create a `greenlit.yml` in your repository:

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
  auto_pr: true
  require_verification: true

output:
  pr_title_template: "fix(greenlit): {failure_type} - {summary}"
  branch_prefix: "greenlit/fix"
```

### GitHub Actions Setup

Add the Greenlit workflow to `.github/workflows/greenlit.yml`:

```yaml
name: Greenlit CI Fix

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

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - run: npm ci && npm run build

      - name: Run Greenlit
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          node dist/index.js triage \
            --run-id ${{ github.event.workflow_run.id }} \
            --repo ${{ github.repository }} \
            --branch ${{ github.event.workflow_run.head_branch }} \
            --sha ${{ github.event.workflow_run.head_sha }}
```

### Required Secrets

- `OPENAI_API_KEY` - Your OpenAI API key

## 📋 How It Works

### The Loop

```
CI Fails → Collect Logs → Classify Failure → Route Decision
                                                    ↓
                              ┌─────────────────────┴─────────────────────┐
                              ↓                     ↓                     ↓
                         Fix Attempt           Report Only          Flake Workflow
                              ↓                     ↓                     ↓
                    Diagnose → Patch →        Post RCA            Quarantine +
                    Verify → PR               Comment              Create Issue
```

### Routing Engine

Greenlit intelligently routes failures:

| Failure Class | Action | Example |
|---------------|--------|---------|
| **Deterministic** | Fix Attempt | Test failure, type error, lint error |
| **Secrets** | Report Only | Missing `GITHUB_TOKEN`, auth failures |
| **Infra Outage** | Report Only | npm registry down, rate limits |
| **Flaky** | Flake Workflow | Intermittent test failures |

### Safety Guardrails

- ✅ **Command allowlist** - Only runs pre-approved commands
- ✅ **Diff size limit** - Patches capped at 200 lines
- ✅ **Forbidden patterns** - Won't touch secrets, lockfiles
- ✅ **Verification required** - Must pass re-run before PR
- ✅ **Branch-only** - Creates PR, never pushes to main

## 🎯 CLI Commands

### `greenlit triage`

Analyze a CI failure and attempt to fix it.

```bash
greenlit triage \
  --run-id 12345 \
  --repo owner/repo \
  --branch feature-branch \
  --sha abc123
```

### `greenlit publish`

Create PR from triage result.

```bash
greenlit publish \
  --result greenlit-result.json \
  --base-branch main
```

### `greenlit analyze`

Quick local analysis of test failures.

```bash
greenlit analyze --command "npm test"
```

## 📊 Output Example

### Auto-PR Body

```markdown
## 🤖 Greenlit Auto-Fix

| | |
|---|---|
| **Failed Run** | #12345 |
| **Failure Type** | test |
| **Confidence** | HIGH |

### Root Cause
The `divide` function had an off-by-one error...

### Fix Applied
Changed `b + 1` to `b` in divide function.

### Verification
✅ `npm test` passed
```

## 🔧 Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck
```

## 📁 Project Structure

```
greenlit/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── collector/            # Log collection & context building
│   │   ├── github-logs.ts
│   │   ├── context-builder.ts
│   │   └── types.ts
│   ├── agent/                # Triage agent & prompts
│   │   ├── orchestrator.ts
│   │   ├── prompts.ts
│   │   └── verifier.ts
│   ├── publisher/            # PR creation
│   │   ├── branch-manager.ts
│   │   └── pr-creator.ts
│   └── config/               # Configuration
│       └── greenlit.config.ts
├── .github/workflows/
│   ├── ci.yml
│   └── greenlit.yml
├── greenlit.yml              # Config file
└── package.json
```

## 🏆 Why Greenlit?

### vs Manual Triage
- **Before**: 30-90 min per failure (read logs, guess, fix, wait for CI)
- **After**: 2-5 min to green with receipts

### vs Other Tools
1. **Routing Engine** - Smart classification (fix vs report vs quarantine)
2. **Verification Loop** - Proves fixes work before PR
3. **Evidence Pack** - Full RCA with logs, diff, and verification output
4. **Fingerprinting** - Deduplication and org-level learning

---

**Built for the OpenAI Engineers Day Hackathon 2026**

> "Greenlit auto-triages failing CI runs and ships minimal verified fix PRs—turning red builds green with evidence."
