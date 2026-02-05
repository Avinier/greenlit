# Greenlit Pivot: CI Incident Response Layer

## One-sentence ELI5

Greenlit turns CI into an incident stream: it summarizes failures, assigns an owner automatically, and remembers recurring failure patterns so the same incident gets faster to resolve every time.

## The pivot in one line

**From:** “auto-fix bot”
**To:** “CI incident response layer (triage → assignment → memory → optional automation)”

---

## What Greenlit is now (the product)

### Greenlit is not a code reviewer

Greenlit does **not** try to judge the quality of every diff. It treats CI like production ops:

- detect incident (failure)
- compress the signal (failure card)
- route to the right responder (owner assignment)
- attach prior incidents and known playbooks (signature memory)
- optionally apply safe automation (rerun, quarantine, or narrow fix suggestion)

This is durable because you are selling **reliability operations**, not “AI fixes code.”

---

## The wedge: automatic ownership + incident packets

### Core workflow

1. CI fails on GitHub Actions.
2. Greenlit posts a “Failure Card” with:
   - failing workflow/job/step
   - likely failing command (or why unknown)
   - first meaningful error + minimal relevant excerpt
   - file/line evidence when available
   - classification (deterministic/flaky/infra/secrets/unknown)
   - **assigned owner** + “why this owner”
3. Greenlit opens or updates a single “incident thread” (PR comment, issue, or check run output).
4. Greenlit consults org memory:
   - “seen before” + prior outcomes + suggested remediation
   - whether to rerun, quarantine, report-only, or escalate

### Why this is a wedge

Most tooling:
- helps you *read* failures
- does not reliably help you *decide and assign*
- does not learn org-wide patterns in a way that changes behavior

Owner routing is the “daily painkiller” that gets installed.

---

## MVP scope (tight, hackathon-realistic, non-generic)

### MVP = Respond + Route + Remember

No Prevent layer is required to be a real product.

#### 1) Failure Card (CI Translate)

Deliverable: one PR comment / check output per failure containing:
- **What failed:** workflow + job + step
- **Error signature:** first real error line (normalized)
- **Evidence pack:** file:line excerpts when present
- **Action suggestion:** rerun / fix / quarantine / report-only / escalate

Success criterion: a dev can decide what to do in under 60 seconds without opening raw logs.

#### 2) Owner Routing (the wedge)

Routing sources, in descending priority:
- **CODEOWNERS** match on referenced file paths / touched files
- **git blame** on referenced failing line / hot files from logs
- **fallback team map** (config: directories → team)
- **last touched commit author** for files referenced in the error signature

Output includes “why assigned” so it feels fair and auditable.

Success criterion: “who owns this?” becomes automatic.

#### 3) Signature Memory (org-level learning)

Keep it immediately useful:
- same signature → link to prior incident card(s)
- show “last resolution” and “commands that worked”
- enforce “don’t spam”: one open incident thread per signature per repo/branch

Success criterion: repeat failures get faster and less noisy.

#### 4) Routing policy (report-only vs attempt)

Keep policy classes; the win is consistent behavior:
- **infra/secrets/permissions/registry** → report-only + remediation steps
- **flaky** → mark suspected flake + suggest rerun / quarantine path
- **deterministic** → assign owner + optional patch suggestion (not PR)

Success criterion: Greenlit is trusted because it often says “do not attempt.”

---

## Optional “Prevent” (only if you really want one check)

If you include any pre-merge check, make it **exactly one deterministic preflight**:

**Dependency drift check**
- “You imported `foo` but `foo` isn’t in `package.json` (or workspace manifest).”
- “You updated `package.json` but not lockfile” (if your repo expects that).
- “You used Node 20 APIs but CI runs Node 18” (only if workflow config is reliably parsed).

This stays out of reviewer territory because it is essentially: *you are about to waste a CI run; don’t.*

---

## Optional automation (post-MVP)

Keep it narrow and safe:
- rerun known flaky suites
- quarantine known flaky tests
- open an issue with a suggested fix (not a PR)
- attach a patch suggestion for manual review

---

## How the existing code maps (with the new emphasis)

- `collector/` stays core: log fetch, context build, evidence extraction
- `agent/routing.ts` becomes policy routing (report-only vs rerun vs assign)
- `agent/signatures.ts` becomes org memory + dedup (not just loop prevention)
- `publisher/` shifts from PR creation to **incident thread management**:
  - post/update comment
  - link prior incidents
  - optionally open an issue for “flake/quarantine/escalate”
- `agent/orchestrator.ts` becomes the **incident responder loop**:
  - summarize → route → assign → remember → optionally suggest action

You are not throwing away architecture; you are swapping the default output from “fix PR” to “incident response.”

---

## Demo story (what makes judges/users feel it)

1. CI fails on a PR.
2. Greenlit posts a Failure Card in the PR with **owner assignment** + evidence.
3. A second CI failure happens of the same type.
4. Greenlit says: “Seen 3 times this week; last time it was fixed by X; here is the prior resolution.”
5. For a flaky signature, Greenlit routes to “flake” and files a single issue with owners + TTL suggestion.

That is a cohesive “CI as incidents” experience, not “we asked an LLM to fix your code.”

---

## What to change in the docs right now

- Delete most of Prevent (keep only dependency drift if anything).
- Move **Owner Routing** to the #1 wedge and make it the hero.
- Remove pricing from the hackathon version entirely.
- Reframe “signature memory” as **org-wide recurrence intelligence**, not “avoid loops.”
