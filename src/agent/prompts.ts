import type { FailureContext, VerificationResult } from "../collector/types.js";
import type { Guardrails } from "../config/greenlit.config.js";

export interface Diagnosis {
  rootCause: string;
  canFix: boolean;
  affectedFiles: string[];
  confidence: "high" | "medium" | "low";
  reasoning: string;
  suggestedFix?: string;
}

/**
 * Agent prompts for each phase of the triage loop
 */
export const PROMPTS = {
  /**
   * System prompt that defines the agent's role and constraints
   */
  system: `You are Greenlit, a CI failure triage agent. Your job is to:
1. Diagnose why CI failed
2. Generate minimal fixes that make CI pass
3. Verify fixes by re-running the failing commands

CONSTRAINTS:
- Make MINIMAL changes - only fix what's broken
- Do NOT refactor, improve, or add features
- Do NOT modify package-lock.json, yarn.lock, or .env files
- Keep patches under 200 lines changed
- Focus on making the failing check pass, nothing more

OUTPUT FORMAT:
Always respond with structured JSON when asked for diagnosis or RCA.
`,

  /**
   * Diagnosis prompt - analyze the failure and determine root cause
   */
  diagnosis: (context: FailureContext) => `
Analyze this CI failure and diagnose the root cause.

## Failure Context
- **Repository**: ${context.repo}
- **Branch**: ${context.branch}
- **Commit**: ${context.sha}
- **Workflow**: ${context.workflowName}
- **Failure Type**: ${context.failureType}
- **Failure Class**: ${context.failureClass}
- **Failed Command**: ${context.failedCommand}

## Error Signature
\`\`\`
${context.errorSignature}
\`\`\`

## Extracted Errors
${context.extractedErrors.slice(0, 10).map(e => `- ${e}`).join("\n")}

## Files Changed in This PR
${context.changedFiles.map(f => `- ${f}`).join("\n") || "- (none detected)"}

## Files Mentioned in Error Logs
${context.relevantFiles.map(f => `- ${f}`).join("\n") || "- (none detected)"}

## Evidence Pack
${context.evidence?.file ? `- **File**: ${context.evidence.file}` : "- **File**: (not detected)"}
${context.evidence?.line ? `- **Line**: ${context.evidence.line}` : "- **Line**: (not detected)"}
${context.evidence?.job ? `- **Job**: ${context.evidence.job}` : "- **Job**: (not detected)"}
${context.evidence?.step ? `- **Step**: ${context.evidence.step}` : "- **Step**: (not detected)"}

## Recent Commits
${context.recentCommits.join("\n") || "(none)"}

## Raw Logs (truncated)
\`\`\`
${context.rawLogs.slice(-6000)}
\`\`\`

---

## Your Task
1. Read the relevant source files to understand the failure
2. Identify the ROOT CAUSE (not just the symptom)
3. Determine if this is fixable with a minimal patch

Respond with JSON:
\`\`\`json
{
  "rootCause": "Clear explanation of why CI failed",
  "canFix": true,
  "affectedFiles": ["path/to/file1.ts", "path/to/file2.ts"],
  "confidence": "high",
  "reasoning": "Your analysis of why this failed",
  "suggestedFix": "Brief description of what needs to change"
}
\`\`\`
`,

  /**
   * Generate fix prompt - apply minimal changes
   */
  generateFix: (diagnosis: Diagnosis, guardrails: Guardrails) => `
Generate a MINIMAL fix for the root cause you identified.

## Root Cause
${diagnosis.rootCause}

## Suggested Fix Direction
${diagnosis.suggestedFix || "Apply minimal changes to fix the failing check"}

## Files to Modify
${diagnosis.affectedFiles.map(f => `- ${f}`).join("\n")}

## CONSTRAINTS (MUST follow)
- Maximum ${guardrails.max_diff_lines} lines changed
- Do NOT modify: ${guardrails.forbidden_patterns.join(", ")}
- Only edit the files listed above
- Keep the fix as small as possible - surgical precision
- Do NOT add extra features, refactoring, or improvements
- Do NOT add comments explaining your fix
- Just make the minimal change to pass CI

## Instructions
1. Read each affected file
2. Make the minimal code changes to fix the issue
3. Focus ONLY on making the failing check pass

After making changes, summarize what you modified in one sentence.
`,

  /**
   * Retry fix prompt - when first fix doesn't work
   */
  retryFix: (failureOutput: string, attempt: number) => `
The previous fix did not pass verification (attempt ${attempt}).

## Verification Output
\`\`\`
${failureOutput.slice(-4000)}
\`\`\`

## Instructions
1. Analyze what went wrong with the previous fix
2. Make additional corrections
3. Keep changes minimal - only fix what's needed to pass

Do NOT:
- Revert to original code and try something completely different
- Add unnecessary error handling or defensive code
- Make changes unrelated to the failure

Focus on fixing the specific issue shown in the verification output.
`,

  /**
   * Generate RCA (Root Cause Analysis) report
   */
  generateRCA: (
    diagnosis: Diagnosis,
    patchDiff: string,
    verification: VerificationResult,
    context: FailureContext
  ) => `
Generate a concise Root Cause Analysis report in markdown format.

## Context
- Failure Type: ${context.failureType}
- Root Cause: ${diagnosis.rootCause}
- Fix Applied: ${diagnosis.suggestedFix || "Minimal patch"}
- Verification: ${verification.passed ? "PASSED" : "FAILED"}

## Patch Applied
\`\`\`diff
${patchDiff.slice(0, 3000)}
\`\`\`

## Verification Command
${verification.command}

## Verification Output (truncated)
\`\`\`
${verification.output.slice(-2000)}
\`\`\`

---

Generate the RCA following this exact template:

\`\`\`markdown
## Summary
[One sentence describing what was fixed]

## Failure Signature
- **Job/Step**: [which step failed]
- **Error**: [exact error message, one line]

## Root Cause
[2-3 sentences explaining WHY this failed]

## Fix Applied
[One sentence describing what was changed]

## Verification
- **Command**: \`${verification.command}\`
- **Result**: ${verification.passed ? "✅ PASSED" : "❌ FAILED"}
\`\`\`
`,

  /**
   * Report-only prompt (for non-fixable failures)
   */
  reportOnly: (context: FailureContext) => `
This CI failure cannot be automatically fixed. Generate a diagnostic report.

## Failure Context
- **Type**: ${context.failureType}
- **Class**: ${context.failureClass}
- **Error**: ${context.errorSignature}

## Why This Can't Be Auto-Fixed
${getReportOnlyReason(context.failureClass)}

## Raw Logs
\`\`\`
${context.rawLogs.slice(-4000)}
\`\`\`

---

Generate a report with:
1. Clear explanation of the failure
2. Recommended manual steps to resolve
3. Who should be notified (if applicable)

Format as markdown.
`
};

/**
 * Get human-readable reason for report-only routing
 */
function getReportOnlyReason(failureClass: string): string {
  const reasons: Record<string, string> = {
    secrets: "This failure is related to missing secrets or credentials. Greenlit cannot add secrets automatically for security reasons.",
    permissions: "This failure is related to access permissions. Manual intervention is required to grant appropriate access.",
    infra_outage: "This failure appears to be caused by an external service outage. No code changes will help - wait for the service to recover.",
    dependency_registry: "This failure is related to a package registry issue (npm, pypi, etc.). This is typically transient - retry the workflow.",
    flaky: "This test appears to be flaky (intermittent failure). Consider quarantining the test while investigating.",
    unknown: "Unable to determine the exact cause. Manual investigation recommended."
  };

  return reasons[failureClass] || reasons.unknown;
}

/**
 * Parse diagnosis JSON from agent response
 */
export function parseDiagnosis(response: string): Diagnosis {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // Fall through to manual parsing
    }
  }

  // Try direct JSON parse
  try {
    return JSON.parse(response);
  } catch {
    // Fall through to manual parsing
  }

  // Manual parsing fallback
  return {
    rootCause: extractField(response, "rootCause") || "Unable to determine root cause",
    canFix: response.toLowerCase().includes('"canfix": true') ||
            response.toLowerCase().includes('"can_fix": true'),
    affectedFiles: extractArrayField(response, "affectedFiles"),
    confidence: extractConfidence(response),
    reasoning: extractField(response, "reasoning") || "",
    suggestedFix: extractField(response, "suggestedFix")
  };
}

function extractField(text: string, field: string): string | undefined {
  const regex = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, "i");
  const match = text.match(regex);
  return match?.[1];
}

function extractArrayField(text: string, field: string): string[] {
  const regex = new RegExp(`"${field}"\\s*:\\s*\\[([^\\]]+)\\]`, "i");
  const match = text.match(regex);
  if (match) {
    return match[1]
      .split(",")
      .map(s => s.trim().replace(/"/g, ""))
      .filter(Boolean);
  }
  return [];
}

function extractConfidence(text: string): "high" | "medium" | "low" {
  if (/"confidence"\s*:\s*"high"/i.test(text)) return "high";
  if (/"confidence"\s*:\s*"medium"/i.test(text)) return "medium";
  return "low";
}
