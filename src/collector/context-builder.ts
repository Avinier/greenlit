import { execSync } from "child_process";
import { createHash } from "crypto";
import type {
  WorkflowRunContext,
  FailureContext,
  FailureType,
  FailureClass,
  RoutingDecision,
  FailedJob
} from "./types.js";

/**
 * Build comprehensive failure context from workflow run data
 */
export async function buildFailureContext(
  runContext: WorkflowRunContext
): Promise<FailureContext> {
  const { failedJobs, repo, headSha, headBranch, workflowName } = runContext;

  // Combine all failed job logs
  const combinedLogs = failedJobs.map(j => j.logs).join("\n---\n");

  // Extract error signature (first meaningful error)
  const errorSignature = extractErrorSignature(combinedLogs);

  // Classify failure type (test/lint/build/typecheck)
  const failureType = classifyFailureType(combinedLogs, failedJobs);

  // Classify failure class (deterministic/flaky/infra/etc)
  const failureClass = classifyFailureClass(combinedLogs, failedJobs);

  // Determine routing decision
  const routingDecision = determineRouting(failureClass);

  // Find the failed command
  const failedCommand = extractFailedCommand(failedJobs, combinedLogs);

  // Extract mentioned file paths
  const relevantFiles = extractFilePaths(combinedLogs);

  // Get git context
  const changedFiles = getChangedFiles();
  const recentCommits = getRecentCommits(5);

  // Generate fingerprint for memory lookup
  const fingerprint = generateFingerprint(failureType, errorSignature, failedJobs);

  return {
    runId: runContext.runId,
    repo: `${repo.owner}/${repo.repo}`,
    branch: headBranch,
    sha: headSha,
    workflowName,
    failureType,
    failureClass,
    routingDecision,
    failedCommand,
    errorSignature,
    relevantFiles,
    rawLogs: combinedLogs,
    extractedErrors: extractErrorMessages(combinedLogs),
    changedFiles,
    recentCommits,
    fingerprint
  };
}

/**
 * Classify the type of failure (test/lint/build/typecheck)
 */
function classifyFailureType(logs: string, jobs: FailedJob[]): FailureType {
  const lowerLogs = logs.toLowerCase();
  const jobNames = jobs.map(j => j.jobName.toLowerCase()).join(" ");

  // Check job names first for explicit signals
  if (jobNames.includes("test") || jobNames.includes("jest") || jobNames.includes("vitest")) {
    return "test";
  }
  if (jobNames.includes("lint") || jobNames.includes("eslint")) {
    return "lint";
  }
  if (jobNames.includes("typecheck") || jobNames.includes("tsc")) {
    return "typecheck";
  }
  if (jobNames.includes("build")) {
    return "build";
  }

  // Fall back to log content analysis
  if (/test (failed|failure)|assertion|expect.*to|✕|failed tests?:/i.test(lowerLogs)) {
    return "test";
  }
  if (/eslint|prettier|lint error|linting/i.test(lowerLogs)) {
    return "lint";
  }
  if (/ts\d+:|type error|cannot find name|type '.*' is not assignable/i.test(lowerLogs)) {
    return "typecheck";
  }
  if (/build (failed|error)|compile error|module not found/i.test(lowerLogs)) {
    return "build";
  }

  return "unknown";
}

/**
 * Classify the class of failure (determines routing)
 */
function classifyFailureClass(logs: string, jobs: FailedJob[]): FailureClass {
  const lowerLogs = logs.toLowerCase();

  // Check for secrets/permissions issues
  const secretsPatterns = [
    /permission denied/i,
    /resource not accessible/i,
    /missing required secret/i,
    /unable to resolve credentials/i,
    /authentication failed/i,
    /401 unauthorized/i,
    /403 forbidden/i,
    /EACCES/i,
    /secret .* not found/i
  ];
  if (secretsPatterns.some(p => p.test(lowerLogs))) {
    return "secrets";
  }

  // Check for external outage / infra issues
  const infraPatterns = [
    /429 too many requests/i,
    /503 service unavailable/i,
    /502 bad gateway/i,
    /ETIMEDOUT/i,
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /dns resolution failed/i,
    /network error/i,
    /rate limit exceeded/i,
    /github api rate/i
  ];
  if (infraPatterns.some(p => p.test(lowerLogs))) {
    return "infra_outage";
  }

  // Check for dependency registry issues
  const depPatterns = [
    /npm err! 404/i,
    /npm err! 503/i,
    /could not resolve.*registry/i,
    /failed to fetch.*package/i,
    /checksum mismatch/i,
    /integrity check failed/i,
    /pypi.*unavailable/i,
    /crates\.io.*error/i
  ];
  if (depPatterns.some(p => p.test(lowerLogs))) {
    return "dependency_registry";
  }

  // Check for flaky signals (this is a simple heuristic)
  const flakyPatterns = [
    /flaky/i,
    /intermittent/i,
    /timeout.*test/i,
    /jest.*exceeded timeout/i,
    /race condition/i
  ];
  if (flakyPatterns.some(p => p.test(lowerLogs))) {
    return "flaky";
  }

  // Default to deterministic (code failure that can be fixed)
  return "deterministic";
}

/**
 * Determine routing decision based on failure class
 */
function determineRouting(failureClass: FailureClass): RoutingDecision {
  switch (failureClass) {
    case "deterministic":
      return "fix_attempt";
    case "flaky":
      return "flake_workflow";
    case "secrets":
    case "permissions":
    case "infra_outage":
    case "dependency_registry":
      return "report_only";
    default:
      return "escalate";
  }
}

/**
 * Extract the primary error signature for fingerprinting
 */
function extractErrorSignature(logs: string): string {
  const patterns = [
    /Error:.*$/m,
    /FAIL.*$/m,
    /error\[E\d+\]:.*$/m,
    /TypeError:.*$/m,
    /AssertionError:.*$/m,
    /ReferenceError:.*$/m,
    /SyntaxError:.*$/m,
    /✕.*$/m,
    /FAILED.*$/m
  ];

  for (const pattern of patterns) {
    const match = logs.match(pattern);
    if (match) {
      return match[0].slice(0, 300);
    }
  }

  // Last resort: find any line with "error" in it
  const errorLine = logs.split("\n").find(l => /error/i.test(l));
  return errorLine?.slice(0, 300) || "Unknown error";
}

/**
 * Extract all error messages from logs
 */
function extractErrorMessages(logs: string): string[] {
  const errors: string[] = [];
  const lines = logs.split("\n");

  for (const line of lines) {
    if (/error|fail|✕|FAIL/i.test(line) && line.trim().length > 10) {
      errors.push(line.trim().slice(0, 200));
    }
  }

  return [...new Set(errors)].slice(0, 20); // Dedupe and limit
}

/**
 * Extract the failed command from job/step info or logs
 */
function extractFailedCommand(jobs: FailedJob[], logs: string): string {
  // Try to find from step names
  for (const job of jobs) {
    for (const step of job.failedSteps) {
      if (step.stepName.toLowerCase().includes("run")) {
        // Try to extract command from step name like "Run npm test"
        const cmdMatch = step.stepName.match(/Run (.+)/i);
        if (cmdMatch) return cmdMatch[1];
      }
    }
  }

  // Try to extract from logs
  const cmdPatterns = [
    /npm (?:run )?\w+/,
    /yarn (?:run )?\w+/,
    /pnpm (?:run )?\w+/,
    /pytest.*$/m,
    /cargo test.*$/m,
    /go test.*$/m,
    /jest.*$/m,
    /vitest.*$/m
  ];

  for (const pattern of cmdPatterns) {
    const match = logs.match(pattern);
    if (match) return match[0];
  }

  return "npm test"; // Default fallback
}

/**
 * Extract file paths mentioned in logs
 */
function extractFilePaths(logs: string): string[] {
  const patterns = [
    /(?:^|\s)((?:src|lib|test|tests|app|packages)\/[\w\-\/\.]+\.\w+)/gm,
    /(?:at |in )([^\s:]+\.[jt]sx?:\d+)/gm,
    /([^\s]+\.[jt]sx?):\d+:\d+/gm
  ];

  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = [...logs.matchAll(pattern)];
    files.push(...matches.map(m => m[1]));
  }

  // Clean up and dedupe
  return [...new Set(files)]
    .map(f => f.replace(/:\d+.*$/, "")) // Remove line numbers
    .filter(f => !f.includes("node_modules"))
    .slice(0, 15);
}

/**
 * Get files changed in the current PR/commit
 */
function getChangedFiles(): string[] {
  try {
    const result = execSync("git diff --name-only HEAD~1 2>/dev/null || git diff --name-only HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get recent commit messages
 */
function getRecentCommits(count: number): string[] {
  try {
    const result = execSync(`git log --oneline -n ${count} 2>/dev/null`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Generate a stable fingerprint for this failure
 * Used for memory/deduplication
 */
function generateFingerprint(
  failureType: FailureType,
  errorSignature: string,
  jobs: FailedJob[]
): string {
  // Normalize error signature by removing variable parts
  const normalizedError = errorSignature
    .replace(/\d+/g, "N")           // Replace numbers
    .replace(/0x[a-f0-9]+/gi, "X")  // Replace hex addresses
    .replace(/\/[\w\-\.\/]+\//g, "/PATH/") // Replace paths
    .replace(/\s+/g, " ")           // Normalize whitespace
    .toLowerCase();

  // Get failing step names
  const stepNames = jobs
    .flatMap(j => j.failedSteps.map(s => s.stepName))
    .sort()
    .join("|");

  const payload = `${failureType}|${stepNames}|${normalizedError}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
