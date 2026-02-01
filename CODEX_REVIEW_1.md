# CODEX Review 1

## Meta overview (from IDEA.md)
Greenlit++ is positioned as an agentic CI failure triage tool that auto-diagnoses red CI runs, produces a minimal fix, reruns verification, and opens a PR with RCA. The MVP++ scope centers on GitHub Actions triggers, failure classification, reproduction/verification loops, minimal patches, and auto-PRs with evidence. Stretch goals include evidence panels and ranked fix candidates, with strong emphasis on safety guardrails and concise RCA reporting. (Evidence: IDEA.md)

## Context file verification
**Expected file:** `docs/CONTEXT.md` (as requested).
- **Status:** Not found in the repository tree at review time. This blocks a point-by-point validation against the context spec.
- **Impact:** I cannot validate specific context requirements; the review below is based on the available implementation and `IDEA.md`. (Evidence: IDEA.md)

## Implementation review vs. IDEA.md (point-by-point coverage)
### 1) Auto-trigger on CI failures
**Status:** Implemented.
- `.github/workflows/greenlit.yml` triggers on `workflow_run` completion for the `CI` workflow and gates on failure, matching the MVP requirement. It checks out the failing SHA and runs Greenlit triage and publish commands. (Evidence: .github/workflows/greenlit.yml)
- **Notes:** Works for GitHub Actions; no support for other CI providers (expected for MVP).

### 2) Failure signature + classification
**Status:** Implemented with heuristics + signature ledger.
- `context-builder.ts` classifies failure type (test/lint/build/typecheck) using job names and log patterns, and failure class (secrets/infra/dependency/flaky/deterministic). This aligns with the MVP classification requirement. (Evidence: src/collector/context-builder.ts)
- `signatures.ts` computes a hash signature with a ledger and enforces per-signature attempt limits. This adds a dedup/rate-limit layer consistent with safety goals. (Evidence: src/agent/signatures.ts)
- **Gaps/risks:**
  - Failure class `permissions` is referenced in routing but never detected in classification, so permission failures likely get categorized as `deterministic` or `unknown` and routed incorrectly. (Evidence: src/agent/routing.ts, src/collector/context-builder.ts, src/collector/types.ts)
  - The signature includes the exact error signature and failed command; in flaky cases this may cause unnecessary uniqueness and reduce dedupe effectiveness. (Evidence: src/agent/signatures.ts)

### 3) Reproduction & verification loop
**Status:** Implemented.
- The triage pipeline runs `verifyFix` for the failed command, with allowlist checks and timeout enforcement. (Evidence: src/agent/orchestrator.ts, src/agent/verifier.ts)
- A retry loop exists with additional model guidance, with verification gating on `require_verification`. (Evidence: src/agent/orchestrator.ts, src/config/greenlit.config.ts)
- **Gaps/risks:**
  - Verification can proceed even if the fix was not applied cleanly, because `generateFix` uses open-ended file writing without verifying patches are coherent beyond diff size/pattern checks. (Evidence: src/agent/orchestrator.ts, src/agent/verifier.ts)
  - There is no explicit capture of the *original* failing command from GitHub logs except via heuristics; if detection is wrong, verification may run a default `npm test` (potentially diverging from the original failure). (Evidence: src/collector/context-builder.ts)

### 4) Minimal patch
**Status:** Implemented with guardrails.
- Patch validation enforces diff size and forbidden patterns, and checks for sensitive tokens. (Evidence: src/agent/verifier.ts)
- **Gaps/risks:**
  - The “no comments” rule in prompts is advisory but not enforced. A model could add comments; the validator only checks diff size and forbidden patterns. (Evidence: src/agent/prompts.ts, src/agent/verifier.ts)
  - `validatePatch` uses simple wildcard-to-regex conversion, which can be overly broad (e.g., `*secret*` may block legitimate identifiers not sensitive). (Evidence: src/agent/verifier.ts)

### 5) Auto-PR with RCA
**Status:** Implemented.
- `publisher/pr-creator.ts` creates a PR with RCA sections, evidence excerpts, verification output, and diff. It also posts PR/commit comments. (Evidence: src/publisher/pr-creator.ts)
- **Gaps/risks:**
  - Branch cleanup is best-effort; if branch checkout fails, it does not reset local changes. In CI this is fine, but for local runs it could leave a dirty workspace. (Evidence: src/publisher/branch-manager.ts)

### 6) Evidence panel (Wow add-on)
**Status:** Implemented in a basic form.
- `evidence.ts` extracts file/line and log excerpt. This is surfaced in PR bodies and RCA output. (Evidence: src/collector/evidence.ts, src/publisher/pr-creator.ts)
- **Gaps/risks:**
  - Evidence extraction relies on a single regex for file:line and chooses the first match, which might not correspond to the actual root cause in multi-error logs. (Evidence: src/collector/evidence.ts)

### 7) Fix candidate ranking (Wow add-on)
**Status:** Not implemented.
- There is no candidate ranking logic; `TriageResult` supports `candidateFixes` but nothing populates it. (Evidence: src/collector/types.ts)

### 8) Guardrails (allowlist + diff/time limits)
**Status:** Implemented.
- Config supports allowlist, max diff lines, runtime caps, and forbidden patterns; `verifyFix` enforces allowlist and timeout. (Evidence: src/config/greenlit.config.ts, src/agent/verifier.ts)
- Signature ledger also acts as a safety throttle. (Evidence: src/agent/signatures.ts)

### 9) Auto-PR details and report quality
**Status:** Implemented.
- RCA format aligns with IDEA: summary, signature, root cause, fix, verification, evidence, diff. (Evidence: IDEA.md, src/publisher/pr-creator.ts, src/agent/prompts.ts)
- **Gaps/risks:**
  - The RCA generation prompt asks for structured markdown but the code does not validate the content. If the model returns malformed output, it still gets used. (Evidence: src/agent/prompts.ts, src/agent/orchestrator.ts)
  - PR body uses `result.fixSummary` directly; if this is a full RCA it may duplicate or be verbose. This might be acceptable but could be formatted for clarity. (Evidence: src/publisher/pr-creator.ts)

## Business logic review (key risks and validation)
1) **Routing consistency mismatch**: `FailureClass` includes `permissions` but classification never sets it. This can route auth errors to fix attempt incorrectly. (Evidence: src/collector/types.ts, src/collector/context-builder.ts, src/agent/routing.ts)
2) **Verification command reliability**: `extractFailedCommand` defaults to `npm test`. In repos without npm tests or with a different failing command, this can give false negatives/positives. (Evidence: src/collector/context-builder.ts)
3) **Patch application risk**: Fix generation writes complete files based on model output. There is no patch-specific check for file deletion or ensuring `affectedFiles` are the only changes. `validatePatch` only checks diff size/patterns, so the model could modify unrelated files. (Evidence: src/agent/orchestrator.ts, src/agent/verifier.ts)
4) **Signature dedupe effectiveness**: Raw error signatures (with environment-specific strings) may be too specific, leading to limited deduplication; consider hashing normalized errors as in `generateFingerprint`. (Evidence: src/agent/signatures.ts, src/collector/context-builder.ts)
5) **Evidence extraction accuracy**: first-match strategy can misattribute root cause. Consider ranking or biasing toward failure step logs. (Evidence: src/collector/evidence.ts)

## Room for improvement (actionable)
- **Add `permissions` classification**: detect typical GitHub/CI permission errors (e.g., “Resource not accessible by integration”, “insufficient scopes”). This aligns routing with config. (Evidence: src/collector/context-builder.ts, src/agent/routing.ts)
- **Improve failed command detection**: parse `steps[].name` for common patterns beyond “Run …” and use job annotations when available. This reduces defaulting to `npm test`. (Evidence: src/collector/context-builder.ts, src/collector/github-logs.ts)
- **Stronger patch validation**: enforce “only affected files” by checking diff paths against `diagnosis.affectedFiles`, and reject file deletions/renames unless explicitly allowed. (Evidence: src/agent/orchestrator.ts, src/agent/verifier.ts)
- **Normalize signature for dedupe**: align `computeSignature` with `generateFingerprint` normalization to avoid excessive uniqueness for flaky/systemic errors. (Evidence: src/agent/signatures.ts, src/collector/context-builder.ts)
- **RCA schema validation**: add a lightweight validator to ensure required sections are present before posting PRs/comments. (Evidence: src/agent/prompts.ts, src/agent/orchestrator.ts, src/publisher/pr-creator.ts)

## Self-review of this document (CODEX_REVIEW_1.md)
- **Completeness:** The review covers the stated IDEA scope and evaluates how the implementation aligns with it, but a full point-by-point validation against `docs/CONTEXT.md` could not be done because the file is missing.
- **Bias check:** The review focuses on functional alignment and risk, and highlights missing context limitations explicitly.
- **Next step:** Obtain or restore `docs/CONTEXT.md` to complete a true “one-by-one” validation against stated context requirements.
