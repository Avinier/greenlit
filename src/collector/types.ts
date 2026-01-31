/**
 * Types for CI failure context collection
 */

export interface WorkflowRunContext {
  runId: number;
  repo: { owner: string; repo: string };
  headSha: string;
  headBranch: string;
  workflowName: string;
  failedJobs: FailedJob[];
}

export interface FailedJob {
  jobId: number;
  jobName: string;
  failedSteps: FailedStep[];
  logs: string;
}

export interface FailedStep {
  stepName: string;
  conclusion: string;
  startedAt: string;
  completedAt: string;
}

export type FailureType =
  | "test"
  | "lint"
  | "build"
  | "typecheck"
  | "unknown";

export type FailureClass =
  | "deterministic"     // Code failure that can be fixed
  | "flaky"             // Intermittent failure
  | "secrets"           // Missing secrets/permissions
  | "permissions"       // Access control issues
  | "infra_outage"      // External service down
  | "dependency_registry" // npm/pypi/etc down
  | "unknown";

export type RoutingDecision =
  | "fix_attempt"       // Try to generate a fix
  | "report_only"       // Just report, no code changes
  | "flake_workflow"    // Quarantine + ticket
  | "escalate";         // Ask for human input

export interface FailureContext {
  // Metadata
  runId: number;
  repo: string;
  branch: string;
  sha: string;
  workflowName: string;

  // Failure classification
  failureType: FailureType;
  failureClass: FailureClass;
  routingDecision: RoutingDecision;

  // Failure details
  failedCommand: string;
  errorSignature: string;
  relevantFiles: string[];

  // Logs
  rawLogs: string;
  extractedErrors: string[];

  // Git context
  changedFiles: string[];
  recentCommits: string[];

  // Fingerprint for memory
  fingerprint: string;
}

export interface TriageResult {
  success: boolean;
  rootCause: string;
  fixSummary: string;
  patchDiff: string;
  verificationLog: string;
  confidence: "high" | "medium" | "low";
  routingDecision: RoutingDecision;
  candidateFixes?: Array<{ description: string; confidence: number }>;
}

export interface VerificationResult {
  passed: boolean;
  command: string;
  output: string;
  exitCode: number;
}

export interface PRDetails {
  prNumber: number;
  prUrl: string;
  branchName: string;
}
