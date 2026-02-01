# Greenlit++: CI Failure Triage Agent (Red ➜ Green PR)

**One-line promise:** Turn a red CI run into a verified green PR in one agent loop.

## 1) Problem to Solve (What hurts today)
Modern teams lose hours to “red CI” incidents:
- CI logs are noisy; root-cause is buried across steps/jobs.
- The failing signal (test, lint, build, infra, flake) is often misclassified.
- Fixing requires context switching: logs → code → git history → reproduce → patch → rerun.
- Humans do repetitive triage work that is highly automatable.

**Outcome we want:** When CI fails, developers should get a **clear, trusted diagnosis** and (ideally) a **tested fix** with minimal time and minimal risk.

---

## 2) What We’re Building (The product)
**Greenlit** is an agentic developer tool that automatically turns failing CI runs into:
- a high-signal **RCA (Root Cause Analysis) report**, and
- a **minimal patch** that makes CI pass (as an auto-PR or as a patch artifact).

### MVP++ Scope (hackathon focus)
**Must-have**
1) **Auto-trigger on CI failures**
   - Runs when a GitHub Actions workflow fails (e.g., `workflow_run` on failure).
2) **Failure signature + classification**
   - Extracts the failing step and error signature; tags as test/lint/build/typecheck.
3) **Reproduction & verification loop**
   - Re-runs the failing command in the same CI environment.
   - After patching, reruns the failing step + relevant tests to prove success.
4) **Minimal patch**
   - Keeps diff small (e.g., <200 lines changed).
5) **Auto-PR with RCA**
   - Posts a markdown RCA with:
     - Summary
     - Failure signature (job/step + exact error)
     - Root cause (why it failed)
     - Fix summary (what changed)
     - Verification (commands run + results)

**Wow add-ons (pick 1–2)**
- **Evidence panel**
  - Show the exact file/line and log excerpt that led to the fix.
- **Fix candidate ranking**
  - Provide 2–3 candidate fixes with confidence; apply the top choice.

---

## 3) Why This Fits the Track (Agentic Software Engineering with Codex)
This is “agentic SDLC leverage” in its purest form:
- The agent executes real tools (tests/lint/build), not just chat.
- It closes the loop with evaluation (CI pass/fail).
- It ships software changes (a PR) with evidence.
- It tackles a real developer pain point: incident triage + CI reliability.

---

## 4) The Wow Factor (What makes judges remember it)
### Wow #1: **Red ➜ Green in one click**
A failing workflow automatically produces a PR that passes CI. That’s the cleanest measurable win.

### Wow #2: **Evidence-first trust**
Greenlit doesn’t just “suggest”; it:
- reproduces the failure,
- makes a minimal patch,
- reruns the checks,
- and shows receipts (commands + outputs summary).

### Wow #3: **Small, surgical fixes**
It focuses on the failing area and produces a minimal diff that is easy to review.

---

## 5) Architecture (Hackathon-realistic)
### Components
1) **GitHub Action trigger**
   - Runs on CI failure and checks out the repo.
2) **Codex CLI non-interactive run**
   - `codex exec` performs triage, patching, and verification.
3) **PR/Comment publisher**
   - Either opens a PR with the patch or posts a report + patch artifact.

---

## 6) Demo Plan (Best possible 3–4 minute flow)
### Demo setup (do this before walking on stage)
- Use a small repo with:
  - 5–10 tests
  - a linter/typecheck
  - CI workflow named “CI”
- Prepare two PRs:
  1) **Intentional break PR**: a tiny change that fails reliably (e.g., off-by-one + failing unit test).
  2) **Flake PR (optional)**: a test that fails intermittently (if doing the flake stretch).

### Live demo script (minute-by-minute)
**Minute 0:00–0:30 — Frame the problem**
- “CI fails, devs waste time reading logs and guessing. Greenlit turns CI failures into verified patches.”

**Minute 0:30–1:10 — Trigger the failure**
- Merge or push the “intentional break PR”.
- Show CI goes red (failing job visible).

**Minute 1:10–2:20 — Watch the agent work**
- Show the Greenlit Action run.
- Emphasize: “It’s running real commands and enforcing guardrails.”

**Minute 2:20–3:10 — The payoff**
- Show the agent output:
  - Root cause summary
  - Patch diff
  - Verification results (tests pass)
- Show the auto-PR exists (or patch artifact + instructions).

**Minute 3:10–3:45 — Close with proof**
- Merge the fix PR.
- CI is green.
- “This reduces MTTR and eliminates repetitive triage.”

### Optional “wow extension” (if you have extra 30–60 seconds)
- Trigger a flaky failure.
- Show it labeling/quarantining and opening a follow-up issue.

---

## 7) What Makes It “Winnable” (Judge-optimized checklist)
### Success metrics (demo-ready)
- **Time-to-green:** target under 2–3 minutes on the demo repo.
- **Patch size:** under 200 lines changed.
- **Verification:** failing step + relevant tests re-run with pass evidence.

### A) Make success objective
- Primary metric: **time-to-green** from failure → passing PR.
- Secondary metrics:
  - # of successful fixes / attempts
  - avg diff size
  - verification reruns count

### B) Make the output high-signal
- Keep the report short and structured.
- Include *only* the most relevant log lines (error signature).
- Always include the commands run for verification.

### C) Make it safe (and say so explicitly)
Judges love “realistic” tooling:
- strict allowlist
- diff limit
- no secrets
- no dependency changes by default
- “opens PR, does not push to main”

### D) Make the failure scenario predictable
Don’t demo on a huge repo.
Use a small, deterministic reproduction case where the agent can succeed reliably.

### E) Tell a crisp story
One-liner:
> “Greenlit auto-triages failing CI runs and ships a minimal verified fix PR—turning red builds green with evidence.”

### F) Make it feel like a product
Add polish:
- a README with “Install in 60 seconds”
- a screenshot/gif of the red→green cycle
- a configuration file (`greenlit.yml`) for:
  - allowed commands
  - max diff
  - max runtime
  - PR title template

### Post-hackathon scope (future hardening)
- Guardrails: allowlist commands, diff/time limits, and secret-safe output.
- Flaky test hunter + auto-quarantine.
- MCP “Deploy/Maintain” flavor (`search_logs`, `get_deploy`, `trace_request`).

---

## 8) Build Checklist (What to implement first, in order)
1) GitHub Action triggers on CI failure.
2) Gather logs + failing command context.
3) Codex-run triage prompt produces an RCA markdown.
4) Patch generation + rerun verification.
5) Auto-PR creation with report as PR body.
6) Guardrails (allowlist + diff/time limits).
7) (Stretch) Flake detection or MCP-based log/deploy correlation.

---

## 9) Deliverables (What you will submit)
- ✅ GitHub repo with:
  - `.github/workflows/greenlit.yml`
  - `scripts/greenlit.sh` (wrapper for codex exec)
  - `greenlit.yml` config (guardrails)
  - `README.md` (setup + demo)
- ✅ A short demo video or GIF (backup if live demo fails).
- ✅ A sample PR link showing:
  - failing run → agent PR → green run

---

## 10) One-slide Pitch (if you need it)
**Greenlit**
- **Problem:** CI failures waste time; humans do repetitive triage.
- **Solution:** Agent reads CI context, reproduces, patches, reruns, and opens a verified PR.
- **Proof:** Red → Green in minutes, with evidence.
- **Safety:** Allowlisted commands + small diffs + no direct pushes.
- **Impact:** Lower MTTR, fewer reruns, faster shipping.


/////EXTRA-NOTES/////

  Before Greenlit (today)

  - CI fails on a PR; dev gets a red check notification.
  - Dev opens Actions, hunts the failing job, scrolls logs, guesses the root cause.
  - They run the failing command locally, repro (or fail to repro).
  - They patch the code, rerun locally, push, wait for CI.
  - If the fix is wrong, they repeat the loop (often multiple times).
  - Result: 30–90 minutes lost on noisy, repetitive triage.

  After Greenlit (with Greenlit enabled)

  - CI fails on a PR; Greenlit is triggered automatically.
  - Greenlit extracts the failing step + error signature, classifies the failure.
  - It replays the failing command in the CI environment.
  - It applies a minimal patch, re‑runs verification, and produces a report.
  - It opens a PR with:
      - Root cause analysis
      - Fix summary
      - Verification output
      - Small diff
  - Dev only needs to review and merge.
  - Result: 2–5 minutes to green, with receipts.
