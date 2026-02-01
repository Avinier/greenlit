import type { FailureContext, RoutingDecision } from "../collector/types.js";
import type { GreenlitConfig } from "../config/greenlit.config.js";

/**
 * Route failures to fix attempts, report-only, or flake workflows.
 */
export function routeFailure(context: FailureContext, config: GreenlitConfig): RoutingDecision {
  const { failureClass, failureType } = context;
  const routing = config.routing;

  if (routing.report_only.includes(failureClass)) {
    return "report_only";
  }

  if (routing.flake_workflow.includes(failureClass)) {
    return "flake_workflow";
  }

  if (routing.fix_attempt.includes(failureType)) {
    return "fix_attempt";
  }

  return "escalate";
}
