# Greenlit++ Implementation Plan

> **Goal**: Build a CI Failure Triage Agent that turns red CI runs into verified green PRs, **CLI-first** with a thin TypeScript orchestrator for product polish.

---

## Executive Summary

Greenlit++ is **CLI-first**: the core triage/patch/verify loop runs via **`codex exec`** in CI for maximum reliability and speed. A **thin TypeScript orchestrator** handles log collection, guardrails, reporting, and PR publishing for a polished developer experience. The Codex SDK and MCP Server are optional extensions for richer orchestration or future service-style deployment.

### Key Integration Points with Codex
| Component | Codex Feature Used | Purpose |
|-----------|-------------------|---------|
| Core Triage Loop (Default) | `codex exec` (non-interactive) | Diagnosis, patching, verification in CI |
| Tool Execution | Sandbox policies (`workspace-write`) | Safe command execution for tests/lint |
| Optional Orchestration | TypeScript SDK (`@openai/codex-sdk`) | Programmatic control, retries, richer telemetry |
| Optional Agent Mesh | `codex mcp-server` | Multi-agent handoffs and tool exposure |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions Workflow                          │
│  (workflow_run trigger on failure)                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────────┐  │
│  │ 1. Collector │───▶│ 2. Codex Agent   │───▶│ 3. PR Publisher       │  │
│  │              │    │    Orchestrator  │    │                       │  │
│  │ - Fetch logs │    │                  │    │ - Create branch       │  │
│  │ - Get diff   │    │ - Classify fail  │    │ - Commit patch        │  │
│  │ - Context    │    │ - Generate fix   │    │ - Open PR with RCA    │  │
│  └──────────────┘    │ - Verify fix     │    └───────────────────────┘  │
│                      │ - Produce RCA    │                                │
│                      └──────────────────┘                                │
│                              │                                           │
│                              ▼                                           │
│                    ┌──────────────────┐                                  │
│                    │ Codex CLI        │                                  │
│                    │ codex exec       │                                  │
│                    │ (non-interactive)│                                  │
│                    └──────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Developer Experience (External View)
- Dev opens PR → CI fails.
- Greenlit posts a comment with: failure signature, root cause summary, fix summary, verification result.
- If fix succeeds, Greenlit opens an auto-PR with a small diff and an RCA report.
- Dev reviews the diff + evidence, merges, and CI turns green.

## Internal Pipeline (High-Level View)
1) Trigger on `workflow_run` failure.  
2) Collect logs, failing job/step, error signature, and likely failing command.  
3) Load guardrails from `greenlit.yml` (allowlist, diff limit, timeouts).  
4) Run `codex exec` to diagnose → patch → verify.  
5) Generate RCA markdown and publish PR (or comment-only if no fix).  

---

## Phase 1: Project Scaffolding

### 1.1 Directory Structure

```
greenlit/
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Main CI workflow (for demo repo)
│       └── greenlit.yml         # Greenlit trigger workflow
├── scripts/
│   └── greenlit.sh               # CLI-first wrapper around codex exec
├── src/
│   ├── index.ts                   # Main entry point
│   ├── collector/
│   │   ├── github-logs.ts         # Fetch CI logs via GitHub API
│   │   ├── context-builder.ts     # Build failure context for agent
│   │   └── types.ts               # FailureContext interface
│   ├── agent/
│   │   ├── orchestrator.ts        # Main Codex SDK orchestration
│   │   ├── prompts.ts             # System prompts for each phase
│   │   ├── classifier.ts          # Failure type classification
│   │   └── verifier.ts            # Re-run and verify fixes
│   ├── publisher/
│   │   ├── branch-manager.ts      # Git operations
│   │   ├── pr-creator.ts          # GitHub PR API
│   │   └── rca-formatter.ts       # RCA markdown generation
│   └── config/
│       └── greenlit.config.ts   # Configuration schema
├── greenlit.yml                 # User-facing config file
├── package.json
├── tsconfig.json
└── README.md
```

### 1.2 Dependencies

```json
{
  "name": "@greenlit/cli",
  "version": "0.1.0",
  "dependencies": {
    "@openai/codex-sdk": "latest",
    "@octokit/rest": "^20.0.0",
    "@octokit/webhooks-types": "^7.3.0",
    "zod": "^3.22.0",
    "commander": "^12.0.0",
    "chalk": "^5.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "vitest": "^1.2.0"
  }
}
```

### 1.3 Configuration Schema (`greenlit.yml`)

```yaml
# greenlit.yml - User configuration
version: 1

# Guardrails
guardrails:
  max_diff_lines: 200           # Maximum lines changed
  max_runtime_seconds: 300      # 5 minute timeout
  allowed_commands:             # Allowlist for verification
    - "npm test"
    - "npm run lint"
    - "npm run build"
    - "npm run typecheck"
    - "pytest"
    - "cargo test"
    - "go test ./..."
  forbidden_patterns:           # Never modify these
    - "*.env*"
    - "*secret*"
    - "package-lock.json"
    - "yarn.lock"

# Behavior
behavior:
  auto_pr: true                 # Create PR automatically
  require_verification: true    # Must pass re-run before PR
  failure_types:                # Which failures to handle
    - test
    - lint
    - typecheck
    - build

# Output
output:
  pr_title_template: "fix(greenlit): {failure_type} - {summary}"
  branch_prefix: "greenlit/fix"
```

---

## Phase 2: Log Collection & Context Building

### 2.1 GitHub Logs Collector (`src/collector/github-logs.ts`)

```typescript
import { Octokit } from "@octokit/rest";

export interface WorkflowRunContext {
  runId: number;
  repo: { owner: string; repo: string };
  headSha: string;
  headBranch: string;
  failedJobs: FailedJob[];
}

export interface FailedJob {
  jobId: number;
  jobName: string;
  failedSteps: FailedStep[];
  logs: string;
}

export interface FailedStep {
  stepName: string;
  conclusion: string;
  startedAt: string;
  completedAt: string;
}

export async function collectFailureContext(
  octokit: Octokit,
  runId: number,
  owner: string,
  repo: string
): Promise<WorkflowRunContext> {
  // 1. Get workflow run details
  const { data: run } = await octokit.rest.actions.getWorkflowRun({
    owner, repo, run_id: runId
  });

  // 2. Get jobs for this run
  const { data: jobs } = await octokit.rest.actions.listJobsForWorkflowRun({
    owner, repo, run_id: runId, filter: "latest"
  });

  // 3. Filter to failed jobs and fetch logs
  const failedJobs: FailedJob[] = [];
  for (const job of jobs.jobs.filter(j => j.conclusion === "failure")) {
    const logs = await fetchJobLogs(octokit, owner, repo, job.id);
    const failedSteps = job.steps?.filter(s => s.conclusion === "failure") || [];

    failedJobs.push({
      jobId: job.id,
      jobName: job.name,
      failedSteps: failedSteps.map(s => ({
        stepName: s.name,
        conclusion: s.conclusion || "unknown",
        startedAt: s.started_at || "",
        completedAt: s.completed_at || ""
      })),
      logs: truncateLogs(logs, 10000) // Keep last 10k chars
    });
  }

  return {
    runId,
    repo: { owner, repo },
    headSha: run.head_sha,
    headBranch: run.head_branch || "unknown",
    failedJobs
  };
}

async function fetchJobLogs(
  octokit: Octokit, owner: string, repo: string, jobId: number
): Promise<string> {
  const { data } = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
    owner, repo, job_id: jobId
  });
  return data as unknown as string;
}

function truncateLogs(logs: string, maxChars: number): string {
  if (logs.length <= maxChars) return logs;
  return "... [truncated] ...\n" + logs.slice(-maxChars);
}
```

### 2.2 Context Builder (`src/collector/context-builder.ts`)

```typescript
import type { WorkflowRunContext } from "./github-logs";
import { execSync } from "child_process";

export interface FailureContext {
  // Metadata
  runId: number;
  repo: string;
  branch: string;
  sha: string;

  // Failure details
  failureType: "test" | "lint" | "build" | "typecheck" | "unknown";
  failedCommand: string;
  errorSignature: string;      // Extracted error pattern
  relevantFiles: string[];      // Files mentioned in errors

  // Logs (truncated)
  rawLogs: string;
  extractedErrors: string[];    // Parsed error messages

  // Git context
  changedFiles: string[];       // Files changed in this PR
  recentCommits: string[];      // Last 5 commit messages
}

export async function buildFailureContext(
  runContext: WorkflowRunContext
): Promise<FailureContext> {
  const { failedJobs, repo, headSha, headBranch } = runContext;

  // Combine all failed job logs
  const combinedLogs = failedJobs.map(j => j.logs).join("\n---\n");

  // Extract error signature (first meaningful error)
  const errorSignature = extractErrorSignature(combinedLogs);

  // Classify failure type
  const failureType = classifyFailure(combinedLogs, failedJobs);

  // Find the failed command
  const failedCommand = extractFailedCommand(failedJobs);

  // Extract mentioned file paths
  const relevantFiles = extractFilePaths(combinedLogs);

  // Get git context
  const changedFiles = getChangedFiles(headSha);
  const recentCommits = getRecentCommits(5);

  return {
    runId: runContext.runId,
    repo: `${repo.owner}/${repo.repo}`,
    branch: headBranch,
    sha: headSha,
    failureType,
    failedCommand,
    errorSignature,
    relevantFiles,
    rawLogs: combinedLogs,
    extractedErrors: extractErrorMessages(combinedLogs),
    changedFiles,
    recentCommits
  };
}

function classifyFailure(logs: string, jobs: any[]): FailureContext["failureType"] {
  const lowerLogs = logs.toLowerCase();

  if (/test (failed|failure)|assertion|expect.*to/.test(lowerLogs)) return "test";
  if (/eslint|prettier|lint/.test(lowerLogs)) return "lint";
  if (/type error|ts\d+:|cannot find name/.test(lowerLogs)) return "typecheck";
  if (/build (failed|error)|compile error/.test(lowerLogs)) return "build";

  return "unknown";
}

function extractErrorSignature(logs: string): string {
  // Find first error-like line
  const patterns = [
    /Error:.*$/m,
    /FAIL.*$/m,
    /error\[E\d+\]:.*$/m,
    /TypeError:.*$/m,
    /AssertionError:.*$/m
  ];

  for (const pattern of patterns) {
    const match = logs.match(pattern);
    if (match) return match[0].slice(0, 200);
  }
  return "Unknown error";
}

function extractFilePaths(logs: string): string[] {
  const filePattern = /(?:^|\s)((?:src|lib|test|tests|app)\/[\w\-\/\.]+\.\w+)/gm;
  const matches = [...logs.matchAll(filePattern)];
  return [...new Set(matches.map(m => m[1]))].slice(0, 10);
}

function getChangedFiles(sha: string): string[] {
  try {
    const result = execSync(`git diff --name-only HEAD~1`, { encoding: "utf-8" });
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function getRecentCommits(count: number): string[] {
  try {
    const result = execSync(`git log --oneline -n ${count}`, { encoding: "utf-8" });
    return result.trim().split("\n");
  } catch {
    return [];
  }
}
```

---

## Phase 3: Codex Agent Orchestrator

### 3.1 Main Orchestrator (`src/agent/orchestrator.ts`)

```typescript
import { Codex, Thread } from "@openai/codex-sdk";
import type { FailureContext } from "../collector/context-builder";
import { PROMPTS } from "./prompts";
import { verifyFix } from "./verifier";

export interface TriageResult {
  success: boolean;
  rootCause: string;
  fixSummary: string;
  patchDiff: string;
  verificationLog: string;
  confidence: "high" | "medium" | "low";
  candidateFixes?: Array<{ description: string; confidence: number }>;
}

export async function runTriageAgent(
  context: FailureContext,
  config: GreenlitConfig
): Promise<TriageResult> {
  const codex = new Codex();

  // Optional: SDK-based orchestration path (CLI-first is default via scripts/greenlit.sh)
  const thread = codex.startThread({
    model: "o4-mini",  // or "codex" depending on availability
    sandboxMode: "workspace-write",
    workingDirectory: process.cwd(),
    approvalPolicy: "on-request"  // Agent can request escalation
  });

  try {
    // ─────────────────────────────────────────────────────────────
    // PHASE 1: Diagnosis
    // ─────────────────────────────────────────────────────────────
    console.log("🔍 Phase 1: Diagnosing failure...");

    const diagnosisPrompt = PROMPTS.diagnosis(context);
    const diagnosisResult = await thread.run(diagnosisPrompt);

    // Extract structured diagnosis from response
    const diagnosis = parseDiagnosis(diagnosisResult.finalResponse);

    if (!diagnosis.canFix) {
      return {
        success: false,
        rootCause: diagnosis.rootCause,
        fixSummary: "Unable to generate automated fix",
        patchDiff: "",
        verificationLog: "",
        confidence: "low"
      };
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 2: Generate Fix
    // ─────────────────────────────────────────────────────────────
    console.log("🔧 Phase 2: Generating fix...");

    const fixPrompt = PROMPTS.generateFix(diagnosis, config.guardrails);
    const fixResult = await thread.run(fixPrompt);

    // Get the diff of changes made
    const patchDiff = await getDiff();

    if (!patchDiff || patchDiff.split("\n").length > config.guardrails.max_diff_lines) {
      throw new Error(`Patch exceeds max diff lines (${config.guardrails.max_diff_lines})`);
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 3: Verify Fix
    // ─────────────────────────────────────────────────────────────
    console.log("✅ Phase 3: Verifying fix...");

    const verificationResult = await verifyFix(
      context.failedCommand,
      config.guardrails.allowed_commands,
      thread
    );

    if (!verificationResult.passed) {
      // Attempt one retry with feedback
      console.log("⚠️  Verification failed, attempting retry...");

      const retryPrompt = PROMPTS.retryFix(verificationResult.output);
      await thread.run(retryPrompt);

      const retryVerification = await verifyFix(
        context.failedCommand,
        config.guardrails.allowed_commands,
        thread
      );

      if (!retryVerification.passed) {
        return {
          success: false,
          rootCause: diagnosis.rootCause,
          fixSummary: "Fix generated but verification failed",
          patchDiff: await getDiff(),
          verificationLog: retryVerification.output,
          confidence: "low"
        };
      }
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 4: Generate RCA Summary
    // ─────────────────────────────────────────────────────────────
    console.log("📋 Phase 4: Generating RCA...");

    const rcaPrompt = PROMPTS.generateRCA(diagnosis, patchDiff, verificationResult);
    const rcaResult = await thread.run(rcaPrompt);

    return {
      success: true,
      rootCause: diagnosis.rootCause,
      fixSummary: parseFixSummary(rcaResult.finalResponse),
      patchDiff,
      verificationLog: verificationResult.output,
      confidence: diagnosis.confidence
    };

  } finally {
    // Thread is automatically cleaned up
  }
}

async function getDiff(): Promise<string> {
  const { execSync } = require("child_process");
  try {
    return execSync("git diff", { encoding: "utf-8" });
  } catch {
    return "";
  }
}

function parseDiagnosis(response: string): {
  rootCause: string;
  canFix: boolean;
  affectedFiles: string[];
  confidence: "high" | "medium" | "low";
} {
  // Parse structured output from agent
  // Expected format uses markdown headers or JSON blocks
  // ...implementation
}
```

### 3.0 CLI-First Default (`scripts/greenlit.sh`)
This wrapper is the **default execution path** in CI. It runs `codex exec` non-interactively with strict guardrails and writes a report artifact.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Load config (guardrails, allowlist, diff limit)
CONFIG_FILE="${1:-greenlit.yml}"

# Run Codex in non-interactive mode
codex exec \
  --sandbox workspace-write \
  --approval-policy on-request \
  --config "$CONFIG_FILE" \
  --input "Run diagnosis → minimal fix → verification for CI failure"
```

### 3.2 Agent Prompts (`src/agent/prompts.ts`)

```typescript
import type { FailureContext } from "../collector/context-builder";

export const PROMPTS = {
  diagnosis: (context: FailureContext) => `
You are Greenlit, a CI failure triage agent. Analyze this CI failure and diagnose the root cause.

## Failure Context
- **Repository**: ${context.repo}
- **Branch**: ${context.branch}
- **Commit**: ${context.sha}
- **Failure Type**: ${context.failureType}
- **Failed Command**: ${context.failedCommand}

## Error Signature
\`\`\`
${context.errorSignature}
\`\`\`

## Extracted Errors
${context.extractedErrors.map(e => `- ${e}`).join("\n")}

## Files Changed in This PR
${context.changedFiles.map(f => `- ${f}`).join("\n")}

## Relevant Files Mentioned in Logs
${context.relevantFiles.map(f => `- ${f}`).join("\n")}

## Recent Commits
${context.recentCommits.join("\n")}

## Raw Logs (truncated)
\`\`\`
${context.rawLogs.slice(-5000)}
\`\`\`

---

## Your Task
1. Read the relevant source files to understand the failure
2. Identify the ROOT CAUSE (not just the symptom)
3. Determine if this is fixable with a minimal patch

Respond with:
\`\`\`json
{
  "rootCause": "Clear explanation of why CI failed",
  "canFix": true/false,
  "affectedFiles": ["list", "of", "files", "to", "modify"],
  "confidence": "high/medium/low",
  "reasoning": "Your analysis"
}
\`\`\`
`,

  generateFix: (diagnosis: any, guardrails: any) => `
Now generate a MINIMAL fix for the root cause you identified.

## Constraints (MUST follow)
- Maximum ${guardrails.max_diff_lines} lines changed
- Do NOT modify: ${guardrails.forbidden_patterns.join(", ")}
- Only edit files: ${diagnosis.affectedFiles.join(", ")}
- Keep the fix as small as possible - surgical precision

## Root Cause
${diagnosis.rootCause}

## Instructions
1. Make the minimal code changes to fix the issue
2. Do NOT add extra features, refactoring, or improvements
3. Focus ONLY on making the failing check pass

After making changes, confirm what you modified.
`,

  retryFix: (failureOutput: string) => `
The previous fix did not pass verification. Here's the output:

\`\`\`
${failureOutput}
\`\`\`

Please analyze what went wrong and make additional corrections.
Keep changes minimal - only fix what's needed to pass.
`,

  generateRCA: (diagnosis: any, patchDiff: string, verification: any) => `
Generate a concise Root Cause Analysis report in markdown format.

## Template
\`\`\`markdown
## Summary
[One sentence describing what was fixed]

## Failure Signature
- **Job/Step**: [which step failed]
- **Error**: [exact error message]

## Root Cause
[Why did this fail? Be specific]

## Fix Applied
[What was changed and why]

## Verification
- **Command**: ${verification.command}
- **Result**: ${verification.passed ? "PASSED" : "FAILED"}

<details>
<summary>Verification Output</summary>

\`\`\`
${verification.output.slice(0, 2000)}
\`\`\`

</details>
\`\`\`

Generate the RCA following this template exactly.
`
};
```

### 3.3 Verification Module (`src/agent/verifier.ts`)

```typescript
import { Thread } from "@openai/codex-sdk";
import { execSync, ExecSyncOptions } from "child_process";

export interface VerificationResult {
  passed: boolean;
  command: string;
  output: string;
  exitCode: number;
}

export async function verifyFix(
  originalCommand: string,
  allowedCommands: string[],
  thread: Thread
): Promise<VerificationResult> {
  // Validate command is in allowlist
  const command = findAllowedCommand(originalCommand, allowedCommands);

  if (!command) {
    return {
      passed: false,
      command: originalCommand,
      output: `Command not in allowlist: ${originalCommand}`,
      exitCode: -1
    };
  }

  console.log(`  Running: ${command}`);

  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 120000, // 2 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB
      stdio: ["pipe", "pipe", "pipe"]
    });

    return {
      passed: true,
      command,
      output,
      exitCode: 0
    };
  } catch (error: any) {
    return {
      passed: false,
      command,
      output: error.stdout + "\n" + error.stderr,
      exitCode: error.status || 1
    };
  }
}

function findAllowedCommand(original: string, allowed: string[]): string | null {
  // Match against allowlist patterns
  for (const pattern of allowed) {
    if (original.includes(pattern.replace(/\s+/g, " ").trim())) {
      return pattern;
    }
    // Check if the failed command contains the allowed command
    const baseCmd = pattern.split(" ")[0];
    if (original.startsWith(baseCmd)) {
      return pattern; // Use the allowed version
    }
  }
  return null;
}
```

---

## Phase 4: PR Publisher

### 4.1 Branch Manager (`src/publisher/branch-manager.ts`)

```typescript
import { execSync } from "child_process";

export async function createFixBranch(
  baseBranch: string,
  branchPrefix: string
): Promise<string> {
  const timestamp = Date.now();
  const branchName = `${branchPrefix}-${timestamp}`;

  // Create and checkout new branch
  execSync(`git checkout -b ${branchName}`, { stdio: "pipe" });

  return branchName;
}

export async function commitChanges(
  message: string
): Promise<string> {
  execSync("git add -A", { stdio: "pipe" });
  execSync(`git commit -m "${message}"`, { stdio: "pipe" });

  const sha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  return sha;
}

export async function pushBranch(branchName: string): Promise<void> {
  execSync(`git push -u origin ${branchName}`, { stdio: "pipe" });
}

export async function cleanupBranch(originalBranch: string): Promise<void> {
  execSync(`git checkout ${originalBranch}`, { stdio: "pipe" });
}
```

### 4.2 PR Creator (`src/publisher/pr-creator.ts`)

```typescript
import { Octokit } from "@octokit/rest";
import type { TriageResult } from "../agent/orchestrator";

export interface PRDetails {
  prNumber: number;
  prUrl: string;
  branchName: string;
}

export async function createPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseBranch: string,
  headBranch: string,
  result: TriageResult,
  failureRunId: number,
  titleTemplate: string
): Promise<PRDetails> {
  const title = formatTitle(titleTemplate, result);
  const body = formatPRBody(result, failureRunId, owner, repo);

  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head: headBranch,
    base: baseBranch
  });

  // Add labels
  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: pr.number,
    labels: ["greenlit", "auto-fix", result.confidence]
  });

  return {
    prNumber: pr.number,
    prUrl: pr.html_url,
    branchName: headBranch
  };
}

function formatTitle(template: string, result: TriageResult): string {
  return template
    .replace("{failure_type}", result.rootCause.split(":")[0] || "ci")
    .replace("{summary}", result.fixSummary.slice(0, 50));
}

function formatPRBody(
  result: TriageResult,
  runId: number,
  owner: string,
  repo: string
): string {
  return `
## Greenlit Auto-Fix

This PR was automatically generated by Greenlit to fix CI failure in run [#${runId}](https://github.com/${owner}/${repo}/actions/runs/${runId}).

---

## Summary
${result.fixSummary}

## Root Cause Analysis

### Failure Signature
\`\`\`
${result.rootCause}
\`\`\`

### Fix Applied
${result.fixSummary}

**Confidence Level**: ${result.confidence.toUpperCase()}

---

## Verification

The fix was verified by re-running the failing command:

<details>
<summary>Verification Output</summary>

\`\`\`
${result.verificationLog.slice(0, 5000)}
\`\`\`

</details>

---

## Changes

\`\`\`diff
${result.patchDiff}
\`\`\`

---

> **Note**: This is an automated fix. Please review carefully before merging.
>
> Generated by [Greenlit](https://github.com/your-org/greenlit)
`;
}
```

---

## Phase 5: GitHub Action Workflow

### 5.1 Greenlit Trigger Workflow (`.github/workflows/greenlit.yml`)

```yaml
name: Greenlit CI Fix

on:
  workflow_run:
    workflows: ["CI"]  # Name of your main CI workflow
    types:
      - completed

permissions:
  contents: write
  pull-requests: write
  actions: read

jobs:
  triage:
    name: Triage CI Failure
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
          fetch-depth: 10

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Codex CLI
        run: npm install -g @openai/codex

      - name: Install Greenlit
        run: npm install -g @greenlit/cli
        # Or: npx @greenlit/cli if published

      - name: Run Greenlit Agent
        id: greenlit
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          greenlit triage \
            --run-id ${{ github.event.workflow_run.id }} \
            --repo ${{ github.repository }} \
            --branch ${{ github.event.workflow_run.head_branch }} \
            --sha ${{ github.event.workflow_run.head_sha }} \
            --output result.json

          echo "result=$(cat result.json | jq -c)" >> $GITHUB_OUTPUT

      - name: Create Fix PR
        if: steps.greenlit.outputs.result && fromJson(steps.greenlit.outputs.result).success
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          greenlit publish \
            --result result.json \
            --base-branch ${{ github.event.workflow_run.head_branch }}

      - name: Post Comment on Failure
        if: steps.greenlit.outputs.result && !fromJson(steps.greenlit.outputs.result).success
        uses: actions/github-script@v7
        with:
          script: |
            const result = ${{ steps.greenlit.outputs.result }};
            // Post diagnostic comment if auto-fix failed
            // ...
```

### 5.2 CLI Entry Point (`src/index.ts`)

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { Octokit } from "@octokit/rest";
import { collectFailureContext } from "./collector/github-logs";
import { buildFailureContext } from "./collector/context-builder";
import { runTriageAgent } from "./agent/orchestrator";
import { createFixBranch, commitChanges, pushBranch } from "./publisher/branch-manager";
import { createPullRequest } from "./publisher/pr-creator";
import { loadConfig } from "./config/greenlit.config";
import * as fs from "fs";

const program = new Command();

program
  .name("greenlit")
  .description("Automated CI failure triage and fix")
  .version("0.1.0");

program
  .command("triage")
  .description("Analyze a CI failure and attempt to fix it")
  .requiredOption("--run-id <id>", "GitHub Actions run ID")
  .requiredOption("--repo <owner/repo>", "Repository")
  .requiredOption("--branch <branch>", "Branch name")
  .requiredOption("--sha <sha>", "Commit SHA")
  .option("--output <file>", "Output file for results", "result.json")
  .option("--config <file>", "Config file", "greenlit.yml")
  .action(async (options) => {
    const config = loadConfig(options.config);
    const [owner, repo] = options.repo.split("/");

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    console.log("📥 Collecting failure context...");
    const runContext = await collectFailureContext(
      octokit,
      parseInt(options.runId),
      owner,
      repo
    );

    const context = await buildFailureContext(runContext);
    console.log(`🔍 Failure type: ${context.failureType}`);
    console.log(`📝 Error: ${context.errorSignature.slice(0, 100)}...`);

    console.log("\n🤖 Running Codex triage agent...");
    const result = await runTriageAgent(context, config);

    // Write result
    fs.writeFileSync(options.output, JSON.stringify(result, null, 2));
    console.log(`\n✅ Result written to ${options.output}`);

    if (result.success) {
      console.log("✅ Fix generated successfully!");
      console.log(`   Confidence: ${result.confidence}`);
    } else {
      console.log("❌ Could not generate automated fix");
      console.log(`   Reason: ${result.fixSummary}`);
    }
  });

program
  .command("publish")
  .description("Create PR from triage result")
  .requiredOption("--result <file>", "Result JSON file")
  .requiredOption("--base-branch <branch>", "Base branch for PR")
  .option("--config <file>", "Config file", "greenlit.yml")
  .action(async (options) => {
    const config = loadConfig(options.config);
    const result = JSON.parse(fs.readFileSync(options.result, "utf-8"));

    if (!result.success) {
      console.log("❌ No successful fix to publish");
      process.exit(1);
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = process.env.GITHUB_REPOSITORY!.split("/");

    // Create branch and commit
    const branchName = await createFixBranch(
      options.baseBranch,
      config.output.branch_prefix
    );

    await commitChanges(`fix: ${result.fixSummary}\n\nGenerated by Greenlit`);
    await pushBranch(branchName);

    // Create PR
    const pr = await createPullRequest(
      octokit,
      owner,
      repo,
      options.baseBranch,
      branchName,
      result,
      parseInt(process.env.GITHUB_RUN_ID || "0"),
      config.output.pr_title_template
    );

    console.log(`✅ PR created: ${pr.prUrl}`);
  });

program.parse();
```

---

## Phase 6: Demo Repository Setup

### 6.1 Demo Repo Structure

```
demo-repo/
├── .github/
│   └── workflows/
│       ├── ci.yml              # Main CI that can fail
│       └── greenlit.yml      # Greenlit action
├── src/
│   ├── math.ts                 # Simple module
│   └── math.test.ts            # Tests that can fail
├── greenlit.yml              # Greenlit config
├── package.json
└── README.md
```

### 6.2 Intentional Failure Example

```typescript
// src/math.ts
export function add(a: number, b: number): number {
  return a + b;
}

export function divide(a: number, b: number): number {
  // BUG: Off-by-one error for demo
  return a / (b + 1);  // Should be: return a / b;
}
```

```typescript
// src/math.test.ts
import { add, divide } from "./math";

test("add works", () => {
  expect(add(2, 3)).toBe(5);
});

test("divide works", () => {
  expect(divide(10, 2)).toBe(5);  // This will fail!
});
```

---

## Phase 7: Guardrails & Safety (Throughout)

### 7.1 Safety Checklist

| Guardrail | Implementation |
|-----------|----------------|
| Command Allowlist | Only run commands from `allowed_commands` in config |
| Diff Size Limit | Reject patches over `max_diff_lines` |
| Time Limit | Timeout after `max_runtime_seconds` |
| No Secrets | Never read or modify `*.env*`, credentials, etc. |
| No Dependencies | Forbid `package-lock.json`, `yarn.lock` changes by default |
| Branch-Only | Creates PR, never pushes to main/protected branches |
| Sandbox Mode | Codex runs with `workspace-write` sandbox |

### 7.2 Security Considerations

```typescript
// src/config/security.ts

export function validatePatch(diff: string, config: GreenlitConfig): boolean {
  const lines = diff.split("\n");

  // Check diff size
  if (lines.length > config.guardrails.max_diff_lines) {
    throw new Error(`Patch too large: ${lines.length} lines`);
  }

  // Check for forbidden patterns
  for (const pattern of config.guardrails.forbidden_patterns) {
    const regex = new RegExp(pattern.replace("*", ".*"));
    if (diff.match(regex)) {
      throw new Error(`Patch modifies forbidden pattern: ${pattern}`);
    }
  }

  // Check for potential secrets
  const secretPatterns = [
    /api[_-]?key/i,
    /secret/i,
    /password/i,
    /credential/i,
    /token/i
  ];

  for (const pattern of secretPatterns) {
    if (diff.match(pattern)) {
      console.warn(`⚠️  Patch may contain sensitive data: ${pattern}`);
    }
  }

  return true;
}
```

---

## Build Order

| Order | Task | Deliverable |
|-------|------|-------------|
| 1 | Project scaffolding | Directory structure, package.json, tsconfig |
| 2 | Config schema | `greenlit.yml` parser |
| 3 | CLI wrapper | `scripts/greenlit.sh` using `codex exec` |
| 4 | GitHub logs collector | `collectFailureContext()` working |
| 5 | Context builder | `buildFailureContext()` with classification |
| 6 | Prompts & parsing | Prompts for diagnosis/fix/verification |
| 7 | Optional SDK orchestrator | `runTriageAgent()` for advanced runs |
| 8 | Verifier module | `verifyFix()` with allowlist |
| 9 | PR publisher | Branch creation, PR with RCA body |
| 10 | CLI entry point | `greenlit triage` + `greenlit publish` |
| 11 | GitHub Action | `greenlit.yml` workflow |
| 12 | Demo repo | Intentional failure test case |
| 13 | End-to-end test | Full red→green demo working |

---

## Success Metrics (Demo-Ready)

| Metric | Target |
|--------|--------|
| Time-to-green | < 3 minutes on demo repo |
| Patch size | < 50 lines (demo), < 200 (max) |
| Verification | Re-runs failing command + passes |
| RCA quality | Has signature, root cause, fix summary |
| Demo reliability | Works 100% on prepared failure cases |

---

## Stretch Goals (Post-MVP)

1. **Evidence Panel**: Show exact file:line + log excerpt that led to fix
2. **Fix Candidate Ranking**: Generate 2-3 candidates, apply highest confidence
3. **Flake Detection**: Identify flaky tests and quarantine them
4. **MCP Tool**: Expose as MCP server so other agents can invoke Greenlit
5. **VS Code Integration**: Use App Server for IDE feedback

---

## Key Files to Implement First

```
1. src/agent/orchestrator.ts     ← Core logic
2. src/agent/prompts.ts          ← Agent instructions
3. src/collector/github-logs.ts  ← CI integration
4. src/index.ts                  ← CLI entry
5. .github/workflows/greenlit.yml ← Action trigger
```

---

## One-Liner Pitch

> **Greenlit** auto-triages failing CI runs using Codex SDK, generates minimal verified patches, and ships fix PRs with root cause analysis—turning red builds green with evidence.
