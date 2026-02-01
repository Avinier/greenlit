import type {
  FailureCard,
  FailureContext,
  MemorySummary,
  OwnerAssignment,
  TriageResult
} from "../collector/types.js";

export function buildFailureCard(
  context: FailureContext,
  result: TriageResult,
  ownerAssignment?: OwnerAssignment,
  memory?: MemorySummary
): FailureCard {
  const summary = buildSummary(context, result);
  const action = buildRecommendedAction(context, result);
  const job = context.evidence?.job;
  const step = context.evidence?.step;

  return {
    title: `Failure Card: ${context.workflowName}`,
    summary,
    workflowName: context.workflowName,
    job,
    step,
    failedCommand: context.failedCommand || "unknown",
    errorSignature: context.errorSignature,
    evidence: context.evidence,
    failureType: context.failureType,
    failureClass: context.failureClass,
    routingDecision: result.routingDecision,
    owner: ownerAssignment,
    memory,
    action
  };
}

function buildSummary(context: FailureContext, result: TriageResult): string {
  const candidate = result.rootCause || context.errorSignature || "CI failure detected";
  return truncateLine(candidate, 180);
}

function buildRecommendedAction(context: FailureContext, result: TriageResult): string {
  switch (result.routingDecision) {
    case "report_only":
      return "Report-only. Review logs and apply a manual fix.";
    case "flake_workflow":
      return "Suspected flake. Rerun the job or quarantine the test.";
    case "fix_attempt":
      return result.success
        ? "Review the suggested fix and merge if correct."
        : "Investigate and apply a manual fix.";
    case "escalate":
      return "Escalate for human investigation.";
    default:
      return `Review failure in ${context.workflowName}.`;
  }
}

function truncateLine(text: string, maxLength: number): string {
  const line = text.split("\n")[0].trim();
  if (line.length <= maxLength) return line;
  return `${line.slice(0, Math.max(0, maxLength - 1))}…`;
}
