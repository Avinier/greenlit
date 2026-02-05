# Cleanup for Pivot 2 Plan

Goal: remove or demote auto-fix oriented behavior so the codebase reflects Pivot 2 (CI incident response first). Every step is atomic and includes proof, decision, action, and verification. If any proof step contradicts a decision, stop and re-evaluate before changing code.

## Constraints
- `docs/PIVOT_2.md` is the single source of truth for final behavior.
- Default behavior is report-only incident response (Failure Card + routing + owner + memory).
- Fix attempts and PR creation are opt-in only.
- Use current codebase structures only (no new subsystems, only gating/refactoring what exists).

## Plan (Atomic Steps)

### Step 0: Prove current defaults and routing assumptions (baseline)
Proof:
- Open `greenlit.yml` and `src/config/greenlit.config.ts` and confirm:
  - `behavior.auto_pr` default is `false`.
  - `routing.fix_attempt` includes `test|lint|typecheck|build`.
  - `behavior.failure_types` exists but is unused in runtime logic.
- Open `src/index.ts` and confirm publish logic:
  - `commentOnly = options.commentOnly || !config.behavior.auto_pr`.

Decision:
- If `auto_pr` default is not `false`, it must be changed.
- If `fix_attempt` is not gated by an explicit opt-in, add a gate.

Action:
- No code changes here. This step only establishes the baseline and what must change later.

Verification:
- Record the confirmed defaults in the plan’s notes (e.g., `auto_pr=false` in current config).
- If any proof does not match, stop and update the plan before proceeding.

---

### Step 1: Remove fix-first messaging from triage output
Proof:
- Open `src/index.ts` and locate triage summary strings (e.g., "Fix generated successfully" / "Analysis complete").

Decision:
- Triage output must describe incident response outcomes (routing + card emitted) rather than fix success.

Action:
- Replace fix-centric strings in `src/index.ts` triage summary with incident-response language.

Verification:
- Run `rg -n "Fix generated|Fix applied" src/index.ts` and confirm these strings are removed or replaced.
- If strings remain, stop and re-edit before proceeding.

---

### Step 2: Make PR creation explicitly opt-in (beyond config)
Proof:
- Open `src/index.ts` and verify that PR creation in `publish` is currently allowed when `config.behavior.auto_pr` is true and `--comment-only` is not set.
- Open `src/publisher/pr-creator.ts` and note “auto-fix” labeling/copy.

Decision:
- PR creation should require an explicit CLI opt-in in addition to config (e.g., `--create-pr`).
- This ensures “incident response first” even when config files are reused across repos.

Action:
- Add `--create-pr` flag to `greenlit publish`.
- Require **both** `config.behavior.auto_pr === true` and `--create-pr` to create a PR; otherwise post comment only.
- Remove or rename "auto-fix" labels/copy in `src/publisher/pr-creator.ts` to "Suggested Fix".

Verification:
- Confirm `greenlit publish` creates a PR only when `--create-pr` is set and `auto_pr` is true.
- Run `rg -n "auto-fix" src` and confirm it is gone from default paths (or only in optional PR text).

---

### Step 3: Align Failure Card copy with incident response framing
Proof:
- Open `src/publisher/pr-creator.ts` and review `formatFailureCardComment` and `formatPRBody`.

Decision:
- Failure Card output should emphasize routing, owner, evidence, memory, and recommended action.
- PR-related copy must clearly read as optional (suggested fix).

Action:
- Adjust Failure Card comment copy to remove fix-first tone.
- Update PR body to remove "Auto-Fix" framing; use "Suggested Fix" language.

Verification:
- Generate a sample Failure Card comment (manual call or lightweight test) and confirm:
  - It reads as an incident packet.
  - It never implies an automatic fix as default.

---

### Step 4: Gate fix attempts in the orchestrator (explicit opt-in)
Proof:
- Open `src/agent/orchestrator.ts` and confirm that `fix_attempt` routes directly into diagnose → fix → verify.
- Confirm there is no explicit config gate for fix attempts (search `rg -n "allow_fix|fix_attempt" src`).

Decision:
- Add a new config gate for fix attempts (e.g., `behavior.allow_fix_attempts: false` by default).
- If routing selects `fix_attempt` but the gate is off, downgrade to `report_only` and emit a Failure Card.

Action:
- Add `behavior.allow_fix_attempts` to `src/config/greenlit.config.ts` and `greenlit.yml` defaulting to `false`.
- Update `runTriageAgent` to check this gate before entering fix logic.

Verification:
- Add a unit test or small harness asserting that with defaults, `runTriageAgent` never performs fix attempts.
- Confirm `greenlit analyze` (Step 6) also respects the gate.

---

### Step 5: Re-orient signature memory from fix retry throttling to incident dedupe
Proof:
- Open `src/agent/signatures.ts` and confirm `shouldAttemptSignature` blocks on attempts/outcome, not on existing thread URLs.
- Open `src/index.ts` publish flow and confirm it always posts a new comment (no thread update logic).

Decision:
- Signature memory should prioritize:
  - one thread per signature,
  - updating the existing thread,
  - surfacing prior outcomes and resolutions in Failure Cards.

Action:
- Extend ledger logic to detect existing `threadUrl` and update the same thread instead of posting a new one.
- Keep attempts/outcome but treat it as memory, not the primary gate to post/update the Failure Card.

Verification:
- Add/update tests to confirm repeat signatures reuse `threadUrl` and Failure Cards show memory.

---

### Step 6: Re-scope or gate `greenlit analyze`
Proof:
- Open `src/index.ts` and confirm `greenlit analyze` sets `routingDecision: "fix_attempt"` and runs `runTriageAgent`.

Decision:
- The analyze command must not imply a default fix workflow.
- Either remove it from the default CLI or make it require `behavior.allow_fix_attempts`.

Action:
- Gate analyze with `behavior.allow_fix_attempts` or move it behind a `--fix` flag.
- Update help text to call it a developer utility, not core incident response.

Verification:
- `greenlit --help` no longer presents analyze as a primary path for the incident response flow.

---

### Step 7: Update `docs/PIVOT_2.md` to reflect the cleaned implementation
Proof:
- After code cleanup, re-open `docs/PIVOT_2.md` and compare against actual behavior.

Decision:
- `docs/PIVOT_2.md` must describe only the final incident-response behavior.

Action:
- Remove references to auto-fix as default.
- Explicitly note fix attempts + PRs are opt-in and gated.

Verification:
- Run `rg -n "auto-fix|auto_pr|PR" docs/PIVOT_2.md` and confirm only optional behavior is described.

---

## Acceptance Criteria
- Default behavior is always Failure Card + routing + owner + memory (comment/check output).
- Fix attempts and PR creation require explicit opt-in (config + CLI gate).
- No auto-fix framing appears in default outputs.
- Signature memory prioritizes incident dedupe and history.
- `docs/PIVOT_2.md` is the single current implementation context.
