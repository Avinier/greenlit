# Greenlit Hackathon Demo Plan (Vercel + GitHub Actions)

## Goal
Ship a live, judge-friendly demo fast: a Vercel-deployed React UI that triggers real CI failures in a playground repo and shows Greenlit’s Failure Card/owner routing. Keep everything in this single codebase, with GitHub Actions handling the heavy lifting.

## Constraints
- Fastest path to “clickable demo.”
- No separate backend service; Vercel is the only deploy.
- Preserve existing Greenlit CLI + Action behavior.
- Demo must be repeatable in minutes.

## Architecture (Minimal but Real)
- **Frontend (Vercel / Next.js):** Single page with scenario selector + “Run demo” button.
- **Vercel API route:** Triggers `workflow_dispatch` on a Playground repo.
- **Playground repo:** Intentionally failing workflows (test/lint/flake) and CODEOWNERS.
- **GitHub Actions (Playground):** Runs the Greenlit Action (this repo) on failure.
- **Output surfacing:** Link to workflow run + PR/comment + artifact (greenlit-result.json / rca).

## Phase 1 — Playground Repo (30–45 min)
1) Create a public repo: `greenlit-playground`.
2) Add failure scenarios:
   - `test_fail`: failing unit test.
   - `lint_fail`: broken lint rule.
   - `flake`: intermittent test (randomized).
3) Add `CODEOWNERS` so owner routing is visible.
4) Add workflow:
   - `workflow_dispatch` input `scenario`.
   - CI that fails based on scenario input.
   - Greenlit Action wired to run on failure.
5) Add secrets:
   - `OPENAI_API_KEY` in Playground repo.

## Phase 2 — Next.js UI in This Repo (60–90 min)
1) Add Next.js app (React) under `/app` or `/web`.
2) UI elements:
   - Scenario dropdown.
   - “Run demo” button.
   - Status panel with links to workflow run + Failure Card comment/PR.
3) Simple UI copy explaining the flow and what to look for.

## UI Design Spec (Minimal + GitHub-Like)
- Palette: pastel green + white, subtle gray borders; no dark mode.
- Layout: single centered card with clear sections; generous whitespace.
- Elements: rounded corners, thin borders, light shadows, minimal icons.
- Typography: clean, system-adjacent (GitHub-like), avoid flashy fonts.
- Logo: use provided logo image; place top-left or header center.
- Tone: minimal, light, professional, product-ready.

## Phase 3 — Vercel API Routes (30–45 min)
1) `POST /api/run-demo`
   - Inputs: `scenario`.
   - Calls GitHub API `workflow_dispatch` on Playground repo.
   - Returns `run_id` or run URL.
2) `GET /api/run-status`
   - Polls GitHub Actions run status by `run_id`.
   - Returns state + links.
3) (Optional) `GET /api/result`
   - Fetch artifact or comment URL if needed.

## Phase 4 — Demo Polish (30 min)
1) Add “How it works” section to the UI.
2) Add an embedded GIF / short screen capture.
3) Add a “Try it now” button on README with the Vercel URL.

## Environment Variables (Vercel)
- `GITHUB_TOKEN` (PAT with `repo` + `workflow` scopes)
- `PLAYGROUND_OWNER` (e.g., `avinier`)
- `PLAYGROUND_REPO` (e.g., `greenlit-playground`)
- `PLAYGROUND_WORKFLOW` (workflow file name or ID)

## Deliverables
- Deployed Vercel URL with live demo controls.
- Playground repo with deterministic failing scenarios.
- Greenlit Action auto-posts Failure Card/comment.
- README includes “Live Demo” link.

## Risks / Mitigations
- **Memory ledger resets:** Use Action cache or accept “memory demo” as best-effort.
- **Workflow permissions:** Ensure `permissions` include `actions: read`, `pull-requests: write`.
- **API rate limits:** Use a dedicated PAT; keep polling low-frequency.

## Out of Scope (for speed)
- Cross-repo incident memory backend.
- Full admin dashboard.
- Multi-tenant auth or billing.

## Suggested Timeline (T-3 hours)
- 0:00–0:45 Playground repo + failures + CI.
- 0:45–2:15 Next.js UI + API routes.
- 2:15–2:45 Vercel deploy + env vars.
- 2:45–3:00 polish + README demo link.
