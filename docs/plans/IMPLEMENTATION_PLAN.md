# Greenlit Implementation Plan (CI Incident Response)

> **Goal**: Turn CI failures into incident packets that are summarized, routed to an owner, and linked to prior incidents. Optional automation is allowed, but **not required** for MVP.

---

## Executive Summary

Greenlit is shifting from “auto-fix PR bot” to a **CI incident response layer**. The MVP delivers:

1. Failure Card (what failed, error signature, evidence)
2. Owner routing (assign + explain)
3. Signature memory (dedupe + prior outcomes)
4. Policy routing (report-only vs rerun/quarantine/escalate)

Auto-fix PRs become optional and off by default.

---

## Non-Goals (MVP)

- No generic code review.
- No broad “Prevent” layer (only optional dependency drift check later).
- No auto-merge or heavy remediation automation.

---

## Architecture Overview (Target)

```
CI Failure
   │
   ▼
Collector → FailureContext → Router → Owner Routing → Signature Memory
   │                                         │
   ▼                                         ▼
Failure Card ------------------------> Incident Thread (comment/check/issue)
   │
   ▼
Optional Automation (rerun/quarantine/patch suggestion)
```

---

## Phase 0: Baseline Alignment

- Update docs to reflect the incident-response pivot.
- Update default config to keep `behavior.auto_pr: false` in examples.
- Add “comment-only” path to all demo workflows.

---

## Phase 1: Failure Card (CI Translate)

**Outcome**: One consistent summary per failure without opening raw logs.

Tasks:
- Define a `FailureCard` schema (new type in `src/collector/types.ts` or `src/agent/types.ts`).
- Add a Failure Card formatter (deterministic template + minimal LLM augmentation).
- Ensure card includes:
  - workflow/job/step
  - error signature
  - evidence excerpt + file/line if available
  - failing command (or “unknown”)
  - routing class + next-step recommendation
- Store Failure Card in `greenlit-result.json` for publishing.

---

## Phase 2: Owner Routing (Core Wedge)

**Outcome**: Automatic assignment + explanation.

Tasks:
- Add CODEOWNERS parser (repo root and `.github/CODEOWNERS`).
- Implement match logic for referenced files:
  - evidence file paths
  - changed files
  - files referenced in error signature
- Add git blame resolver for file:line evidence.
- Add fallback team map config: directory prefix → team.
- Output an assignment with “why this owner” and confidence level.

Config additions:
- `owner_routing.codeowners_paths`
- `owner_routing.blame_depth`
- `owner_routing.team_map`
- `owner_routing.fallback_owner`

---

## Phase 3: Signature Memory (Dedup + Prior Outcomes)

**Outcome**: Repeat failures get faster and less noisy.

Tasks:
- Extend signature ledger to store:
  - incident thread id/link
  - last resolution summary
  - last owner assignment
  - last updated timestamp
- Add “one open thread per signature per repo/branch” rule.
- Surface “seen before” and last resolution in the Failure Card.

---

## Phase 4: Policy Routing + Incident Thread Management

**Outcome**: Consistent behavior and trusted recommendations.

Tasks:
- Update `agent/routing.ts` to emit:
  - report_only
  - rerun
  - quarantine
  - escalate
  - optional_fix
- Update `publisher/` to:
  - post or update a Failure Card comment/check
  - link prior incidents
  - create issue for flaky/quarantine if configured
- Ensure `publish` supports comment-only by default.

Config additions:
- `routing.actions` (class → action)
- `incident_output.target` (comment, check, issue)
- `incident_output.dedupe_by_signature`

---

## Phase 5: Optional Automation (Post-MVP)

**Outcome**: Safe, narrow automation that does not erode trust.

Tasks:
- Add rerun suggestion or auto-rerun for flake class.
- Add quarantine suggestion template (labels or issue).
- Allow patch suggestions **without auto-PR** unless explicitly enabled.

---

## Phase 6: Optional Prevent (Single Deterministic Check)

**Outcome**: Stop obvious CI waste without becoming a reviewer.

Tasks:
- Add dependency drift check:
  - imports not in manifest
  - manifest changed without lockfile
  - runtime mismatch (only if workflow is reliably parsed)

---

## Testing Plan

- Unit tests for CODEOWNERS matching and blame routing.
- Unit tests for signature ledger dedupe + thread update.
- Snapshot tests for Failure Card formatting.
- Integration test with a known failing workflow log.

---

## Deliverables Checklist

- Failure Card output present in `greenlit-result.json`.
- Owner assignment + “why this owner” shown in incident thread.
- Signature memory links prior incidents.
- Default behavior is comment-only; PRs are optional.

