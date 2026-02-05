# Pivot 2: CI failure triage is a system-level incident response problem

We are anchoring Greenlit around **post-failure CI incident response**, because many CI failures are not pure code bugs and cannot be prevented upstream by AI code review or AI-generated tests.

**Primary goal:** resolve CI failures that are **infra, dependency, or environment driven** (not code driven).  
**Secondary goal:** only attempt code fixes when the failure is deterministic and reproducible.

This shifts Greenlit from “auto-fix code” to a **CI incident response system**: classify → route → remediate → verify → learn.

---

## What this means for Greenlit (system principles)
1. **Routing over patching**  
Make the decision explicit: report-only vs. flake workflow vs. fix attempt.

2. **Owner assignment with explainability**  
Route to the right person or team with a clear reason.

3. **Guardrails and verification**  
If a fix is attempted, enforce strict patch limits and verify via allowlisted commands.

4. **Memory and grouping**  
Treat repeat failures as incidents with history, not fresh mysteries.

5. **Outcome learning is the moat**  
Track whether remediation actually worked (fix merged, rerun green, manual resolution) and use that history to improve routing and recommendations over time.

6. **Evidence-first**  
A compact evidence pack beats a long log dump.

7. **Liquid classification**  
Classification should be probabilistic and overrideable, not rigid rules. It should evolve as the system learns from outcomes.

---

## 1) Flakiness isn’t always code — it’s often infrastructure
In Kubernetes-based CI, **workflow-level flakiness** can come from pod evictions, scheduling delays, throttling, cluster timeouts, and other orchestration behaviors that make tests fail even when the test logic is correct. These failures look like flaky tests but are actually infrastructure problems. Testkube’s analysis explicitly separates test-level flakiness from workflow-level flakiness and lists common K8s failure modes. [Testkube][1]

---

## 2) Dependency, config, and environment drift are major CI failure sources
CI failures often come from **dependency and environment issues**: network-related dependency downloads, private registry authentication, resource constraints (timeouts, memory/CPU, disk), and integration/authentication failures between tools. AlgoCademy’s CI failure guide highlights dependency caching/lockfiles to avoid network failures, private registry auth patterns, resource constraints, and integration authentication failures as recurring failure causes. [AlgoCademy][2]

---

## 3) Flaky tests are expensive (measured, not hypothetical)
A five-year industrial case study (∼30 developers, ∼1M SLoC) found that **at least 2.5% of productive developer time** goes to flaky tests: 1.1% investigating suspected flakes, 1.3% repairing them, and 0.1% building monitoring tools. The same study reports reruns are cheap relative to manual investigation. [ESEC/FSE study][3]

---

## 4) Failure categories show infra + dependency issues are common
Large-scale analysis of flaky builds in GitHub Actions identifies **flaky tests, network issues, and dependency resolution issues** as the most prevalent categories of flaky failures. [Flaky Builds in GitHub Actions][4]

Another 2026 study on intermittent job failures lists **non-deterministic tests, network outages, infrastructure failures, and resource exhaustion** as common intermittent failure causes. [Intermittent Job Failures (arXiv)][5]

---

## 5) AI upstream doesn’t cover most of this (and teams know it)
A JetBrains CI/CD survey shows that **most AI use in CI/CD is reactive**: the most common use cases are build-issue debugging and failure analysis, code quality checks, and testing/pipeline optimization. It also reports that **73% of respondents aren’t using AI in CI/CD at all**, signaling adoption is still limited. [JetBrains CI/CD survey][6]

This reinforces the gap: AI code review and AI test generation can help with some logic bugs, but **infra, dependency, and environment failures happen after the code is already merged**.

---

## 6) Market signal (vendor claim)
Gitar’s own marketing estimates claim that developers can lose **up to 30% of their day** to CI problems, and that a 20-person team can lose **~$1M/year** in productivity. This is a vendor claim, but it aligns with the general direction of the academic and industry evidence on CI failure cost. [Gitar marketing][7]

---

## 7) Where Greenlit fits
Greenlit occupies the **post-failure gap** that upstream AI can’t close:

1. **Triage after CI fails** (collect logs, extract evidence).
2. **Classify the root cause** with probabilistic signals (code vs. infra vs. dependency vs. auth).
3. **Route to the right owner** with an explanation.
4. **Attempt a fix when safe**, or issue remediation when it’s not.
5. **Verify and record memory**, so repeated failures get faster to resolve.

This is the part of the lifecycle where flaky tests and system-level CI failures live — and where most existing tools still underdeliver.

---

## 8) Infra tool access is the unlock (but must be gated)
The market already shows that **infra-aware agents** are the next step — but they are focused on **production incidents**, not CI failures:

- **PagerDuty SRE Agent** emphasizes diagnostics + remediation recommendations with approval workflows. [PagerDuty SRE Agent][8]
- **AWS DevOps Agent (preview)** frames itself as a frontier agent that learns resource relationships and correlates telemetry and code to resolve incidents. [AWS DevOps Agent][9]
- **Rootly** demonstrates automated Kubernetes remediation via workflows (rollback, scale, restart). [Rootly remediation][10]
- **Kestrel** markets AI-native cloud incident response with GitOps/IaC PR workflows. [Kestrel AI][11]
- **K8sGPT** offers experimental auto‑remediation for Kubernetes resources. [K8sGPT auto‑remediation][12]

**Gap:** These tools are triggered by production incidents, not CI failures. Greenlit can be the first system that **connects CI failure signals to infra diagnostics**.

### A tiered access model (low → high risk)
**Tier 1: Read‑only diagnostics (default)**  
`kubectl get/describe/logs`, cloud logging queries, registry status checks, status pages.  
Goal: turn “test failed” into “OOMKilled on node X” or “DNS failure in runner.”

**Tier 2: Safe, reversible actions (approval‑gated)**  
`kubectl rollout restart`, temporary scale adjustments, cache invalidation.  
Goal: quick remediation with clear rollback.

**Tier 3: High‑risk changes (proposal only)**  
IaC, IAM/RBAC, network policy changes.  
Goal: propose with evidence, never auto‑apply.

### Security posture must be first‑class
Surveys show agentic automation already **crosses trust boundaries**: 39% of organizations report AI agents accessed unauthorized systems, and 32% reported sensitive downloads. [SailPoint survey summary][13]  
This makes least‑privilege identities, short‑lived credentials, full audit logs, and sandboxed execution non‑negotiable. Google’s **Agent Sandbox** initiative for Kubernetes emphasizes isolation as a core primitive for running agent code safely. [Agent Sandbox][14]

### Operational loop
**Propose → approve → execute → verify → learn**  
This is the pattern that aligns with enterprise trust: the agent drafts the remediation, a human approves, the system verifies, and the result becomes memory for next time.

---

## MVP++ scope (what we build on top of this pivot)

### Core system (MVP, already in place)
1. GitHub Actions log collection + evidence pack.
2. Failure classification + routing decisions.
3. Owner assignment with explainability.
4. Guardrailed fix attempt + verification loop.
5. Failure Card + RCA output.
6. Signature ledger for memory and dedupe.

### MVP++ additions (high leverage for the pivot)
1. **Failure grouping across jobs/runs** into one incident thread.
2. **Fix playbooks** to reduce LLM variance (lint/typecheck/test/flake).
3. **Confidence‑gated PRs** with explicit criteria (only on verified fixes).
4. **Outcome tracking + learning** (fix merged → green, rerun → green, manual fix).
5. **Slack/Teams notifications** with a clear decision: rerun vs. investigate.
6. **Tier‑1 infra diagnostics integration** into the Failure Card.

### Non‑negotiable behavior
1. Infra/deps/env failures default to **report‑only remediation**.
2. Auto‑fix is opt‑in and only for deterministic failures with a reliable repro.
3. All automated actions must be explainable and reversible.
4. Report‑only must beat the “just rerun” path with faster clarity and better signal.

---

## Explicit risk to manage
**The “just rerun” trap:** if report‑only doesn’t answer “rerun or investigate?” faster than a developer can click re-run, adoption stalls. The Failure Card must surface that decision immediately.

---

## References
[1]: https://testkube.io/blog/flaky-tests-cicd-kubernetes-infrastructure-issues
[2]: https://algocademy.com/blog/why-your-continuous-integration-pipeline-keeps-failing-and-how-to-fix-it/
[3]: https://mediatum.ub.tum.de/doc/1730194/1730194.pdf
[4]: https://arxiv.org/html/2409.15335v2
[5]: https://arxiv.org/abs/2508.19732
[6]: https://www.jetbrains.com/lp/devecosystem-2025/ci-cd/
[7]: https://gitar.ai/blog/p/5-statistics-why-ci-is-holding-your-team-back/
[8]: https://www.pagerduty.com/ai/sre-agent/
[9]: https://aws.amazon.com/about-aws/whats-new/2025/11/aws-devops-agent-public-preview/
[10]: https://rootly.com/blog/automated-remediation-using-workflows
[11]: https://kestrel.ai/
[12]: https://k8sgpt.ai/autoremediation/
[13]: https://www.helpnetsecurity.com/2025/05/21/ai-agents-security-risks/
[14]: https://cloud.google.com/blog/products/containers-kubernetes/kubernetes-ai-agents?hl=en
