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

export interface EvidencePack {
  file?: string;
  line?: string;
  excerpt?: string;
  job?: string;
  step?: string;
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
  | "secrets"           // Missing secrets
  | "permissions"       // Access control issues
  | "infra_outage"      // External service down
  | "dependency_registry" // npm/pypi/etc down
  | "unknown";

export type RoutingDecision =
  | "fix_attempt"       // Try to generate a fix
  | "report_only"       // Just report, no code changes
  | "flake_workflow"    // Quarantine + ticket
  | "escalate";         // Ask for human input

export type OwnerAssignmentSource =
  | "codeowners"
  | "blame"
  | "team_map"
  | "last_commit"
  | "fallback"
  | "unknown";

export interface OwnerAssignment {
  owner: string;
  source: OwnerAssignmentSource;
  reason: string;
  confidence: "high" | "medium" | "low";
  candidates?: string[];
  file?: string;
  line?: string;
}

export interface MemorySummary {
  seenBefore: boolean;
  lastSeen?: string;
  lastOutcome?: string;
  lastOwner?: string;
  lastResolution?: string;
  threadUrl?: string;
}

export interface FailureCard {
  title: string;
  summary: string;
  workflowName: string;
  job?: string;
  step?: string;
  failedCommand?: string;
  errorSignature: string;
  evidence?: EvidencePack;
  failureType: FailureType;
  failureClass: FailureClass;
  routingDecision: RoutingDecision;
  owner?: OwnerAssignment;
  memory?: MemorySummary;
  action: string;
}

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

  // Evidence pack
  evidence?: EvidencePack;

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
  ownerAssignment?: OwnerAssignment;
  memory?: MemorySummary;
  failureCard?: FailureCard;
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
