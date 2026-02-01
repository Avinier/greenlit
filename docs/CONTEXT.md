GREENLIT: CODEBASE CONTEXT (PIVOT: CI INCIDENT RESPONSE LAYER)

Project Summary

Greenlit is a CI incident response layer that turns failing GitHub Actions runs into a Failure Card, assigns an owner, and links prior incidents so repeat failures are faster to resolve. Built for the OpenAI Engineers Day Hackathon 2026.

Core Promise (pivot): Turn a red CI run into an **incident packet** with routing, memory, and safe next-step guidance.

Current Status Note

The current codebase still includes an auto-fix PR loop (diagnose → patch → verify → open PR). The pivot repurposes that architecture toward incident response: summarize, route, assign, remember, and only suggest fixes when safe.

---
1. OVERALL PROJECT STRUCTURE

/Users/avinier/Projects.py/openai-engg-day-project/
├── src/                          # Main TypeScript source code
│   ├── index.ts                  # CLI entry point (triage, publish, analyze)
│   ├── collector/                # Failure context collection
│   │   ├── github-logs.ts        # Fetch GitHub Actions logs
│   │   ├── context-builder.ts    # Build failure context
│   │   ├── evidence.ts           # Extract evidence pack
│   │   └── types.ts              # Type definitions
│   ├── agent/                    # Triage agent (summarize → route → optional fix)
│   │   ├── orchestrator.ts       # Main agent loop
│   │   ├── prompts.ts            # OpenAI prompts
│   │   ├── routing.ts            # Failure classification routing
│   │   ├── signatures.ts         # Failure signature memory ledger
│   │   └── verifier.ts           # Fix verification & validation (optional)
│   ├── publisher/                # Incident thread publishing
│   │   ├── pr-creator.ts         # Posts comments / creates PRs
│   │   └── branch-manager.ts     # Git branch operations
│   └── config/                   # Configuration management
│       └── greenlit.config.ts    # YAML config + Zod validation
├── .github/workflows/
│   ├── ci.yml                    # Main CI workflow
│   └── greenlit.yml              # Greenlit auto-trigger workflow
├── greenlit.yml                  # Configuration file
├── package.json                  # Node.js dependencies
├── tsconfig.json                 # TypeScript config
└── vitest.config.ts              # Test config

---
2. PURPOSE & KEY FEATURES (PIVOT)

Problem It Solves
- CI failures waste time in manual triage.
- Teams still ask “who owns this?” in Slack.
- Repeat failures cause noise and slow recovery.

Key Features (MVP)
1. Failure Card (CI Translate) - summary, error signature, evidence
2. Owner routing - assign a responder with “why this owner”
3. Signature memory - link prior incidents and outcomes
4. Policy routing - report-only vs rerun/quarantine/escalate
5. Optional automation - safe rerun or patch suggestion

---
3. ENTRY POINTS & MAIN COMPONENTS

CLI Entry Point: /src/index.ts

Command 1: greenlit triage
- Collects CI failure context from GitHub
- Classifies failure type/class and routing decision
- Computes signature fingerprint and consults ledger
- Produces Failure Card content and optional suggestion
- Output: greenlit-result.json, greenlit-result-rca.md

Command 2: greenlit publish
- Reads triage result from JSON
- Posts or updates incident thread (PR comment / check output)
- Optionally opens PR if auto_pr is enabled

Command 3: greenlit analyze
- Local analysis of a failing command or log file
- Useful for testing locally

---
4. DATA FLOW & MODULE CONNECTIONS (PIVOT)

Phase 1: COLLECTION (collector/)
- Fetch workflow run details and logs via Octokit
- Build FailureContext with errors, file paths, evidence, and git context

Phase 2: CLASSIFICATION & POLICY (agent/routing.ts)
- Map failure class to routing decision:
  report_only | rerun | quarantine | escalate | optional_fix

Phase 3: SIGNATURE MEMORY (agent/signatures.ts)
- Compute a signature for dedupe and history
- Store outcomes and link prior incidents

Phase 4: INCIDENT RESPONSE (agent/orchestrator.ts)
- Summarize failure into a Failure Card
- Attach evidence and recommended action
- (Optional) generate a patch suggestion

Phase 5: PUBLISHING (publisher/)
- Post or update a single incident thread per signature
- Link prior incident card(s)
- Optional issue creation for flake/quarantine

---
5. ROUTING POLICY (TARGET BEHAVIOR)

| Failure Class       | Action                                                  |
|--------------------|---------------------------------------------------------|
| Deterministic       | Assign owner + report-only (optional suggestion)         |
| Flaky               | Mark suspected flake + rerun/quarantine guidance          |
| Secrets             | Report-only + remediation steps                           |
| Infra Outage        | Report-only + status references                           |
| Dependency Registry | Report-only + remediation steps                           |

---
6. SIGNATURE MEMORY (CURRENT + TARGET)

Current
- Signature ledger prevents retry loops (max attempts, TTL).

Target
- Link prior incidents for the same signature.
- Store last resolution and “commands that worked.”
- Enforce one open incident thread per signature per repo/branch.

---
7. PUBLISHER RESPONSIBILITIES (CURRENT + TARGET)

Current
- Creates branches and PRs for auto-fix flow.
- Posts comments and RCA markdown.

Target
- Post or update a Failure Card (PR comment or check output).
- Link prior incidents and dedupe threads.
- Create issues for flaky/quarantine routing when needed.
- Keep PR creation optional and off by default.

---
8. CONFIGURATION (greenlit.yml)

Current
- Guardrails, behavior flags, routing classes, signature ledger settings.

Planned Additions (Pivot)
- owner_routing: CODEOWNERS, blame depth, fallback team map
- incident_output: comment/check/issue target
- memory: “link prior incidents,” TTL policy, thread dedupe

---
9. GITHUB WORKFLOWS

.github/workflows/ci.yml
- Runs lint/build/test on pushes and PRs.

.github/workflows/greenlit.yml
- Triggers on CI failure.
- Runs triage and publishes a Failure Card (comment-only by default).

---
10. PROMPTS & AI INTEGRATION

Agentic flow uses the Codex SDK (TypeScript) with a single thread per triage:
- Plan → Diagnose → (Optional) Fix → Verify → RCA
- File edits are performed by Codex when allowed; guardrails still enforce diff limits

Prompt needs still include:
- Failure Card summarization prompt
- Owner routing explanation template
- Report-only guidance template

---
11. VERIFICATION & VALIDATION

Verification remains optional:
- Required only if auto_pr or patch suggestion is enabled.
- Guardrails still apply: command allowlist, diff size limits, forbidden patterns.

---
12. KEY CHARACTERISTICS (PIVOT)

Reliability Operations Focus
- Treat CI failures as incidents with clear ownership and history.

Evidence First
- Always include error signature and file/line excerpts when available.

Trust Through Restraint
- Prefer report-only guidance; do not attempt risky fixes.

---
FILE MANIFEST

Source Files (15 total):
1. /src/index.ts - CLI entry point
2. /src/collector/github-logs.ts - Fetch GitHub Actions logs
3. /src/collector/context-builder.ts - Build failure context
4. /src/collector/evidence.ts - Extract evidence pack
5. /src/collector/types.ts - Type definitions
6. /src/agent/orchestrator.ts - Agent main loop
7. /src/agent/prompts.ts - OpenAI prompts
8. /src/agent/routing.ts - Route failures
9. /src/agent/signatures.ts - Signature ledger
10. /src/agent/owner-routing.ts - Owner assignment logic
11. /src/agent/failure-card.ts - Failure Card builder
12. /src/agent/verifier.ts - Fix verification
13. /src/publisher/pr-creator.ts - Publish comments / PRs
14. /src/publisher/branch-manager.ts - Git operations
15. /src/config/greenlit.config.ts - Config management

Config & Workflows:
- /greenlit.yml - User configuration
- /.github/workflows/ci.yml - Main CI workflow
- /.github/workflows/greenlit.yml - Greenlit auto-trigger

Package Files:
- package.json
- tsconfig.json
- vitest.config.ts
