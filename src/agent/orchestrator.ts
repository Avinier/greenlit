import OpenAI from "openai";
import fs from "fs";
import path from "path";
import type { FailureContext, TriageResult, VerificationResult } from "../collector/types.js";
import type { GreenlitConfig } from "../config/greenlit.config.js";
import { PROMPTS, parseDiagnosis, type Diagnosis } from "./prompts.js";
import { verifyFix, validatePatch, getCurrentDiff } from "./verifier.js";
import { execSync } from "child_process";

const openai = new OpenAI();

/**
 * Main triage agent orchestrator
 * Runs the diagnosis → fix → verify loop
 */
export async function runTriageAgent(
  context: FailureContext,
  config: GreenlitConfig
): Promise<TriageResult> {
  console.log("\n🤖 Starting Greenlit Triage Agent");
  console.log(`   Failure Type: ${context.failureType}`);
  console.log(`   Failure Class: ${context.failureClass}`);
  console.log(`   Routing: ${context.routingDecision}`);

  // Check routing decision
  if (context.routingDecision === "report_only") {
    return await generateReportOnly(context);
  }

  if (context.routingDecision === "flake_workflow") {
    return await handleFlakeWorkflow(context);
  }

  if (context.routingDecision === "escalate") {
    return {
      success: false,
      rootCause: "Unable to classify failure",
      fixSummary: "Manual investigation required",
      patchDiff: "",
      verificationLog: "",
      confidence: "low",
      routingDecision: "escalate"
    };
  }

  // Proceed with fix attempt
  try {
    // ─────────────────────────────────────────────────────────────
    // PHASE 1: Diagnosis
    // ─────────────────────────────────────────────────────────────
    console.log("\n🔍 Phase 1: Diagnosing failure...");

    const diagnosis = await runDiagnosis(context);
    console.log(`   Root Cause: ${diagnosis.rootCause.slice(0, 100)}...`);
    console.log(`   Can Fix: ${diagnosis.canFix}`);
    console.log(`   Confidence: ${diagnosis.confidence}`);

    if (!diagnosis.canFix) {
      return {
        success: false,
        rootCause: diagnosis.rootCause,
        fixSummary: "Unable to generate automated fix",
        patchDiff: "",
        verificationLog: "",
        confidence: diagnosis.confidence,
        routingDecision: context.routingDecision
      };
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 2: Generate Fix
    // ─────────────────────────────────────────────────────────────
    console.log("\n🔧 Phase 2: Generating fix...");

    const allowedFiles = normalizeAllowedFiles(
      diagnosis.affectedFiles.length ? diagnosis.affectedFiles : context.relevantFiles
    );
    if (!allowedFiles.length) {
      console.log("   ⚠️  No allowed files identified; file updates will be blocked for safety.");
    }

    await generateFix(diagnosis, config.guardrails, allowedFiles);

    // Get and validate the diff
    let patchDiff = getCurrentDiff();
    const validation = validatePatch(
      patchDiff,
      config.guardrails.max_diff_lines,
      config.guardrails.forbidden_patterns
    );

    if (!validation.valid) {
      console.log(`   ⚠️  Patch validation failed: ${validation.reason}`);
      // Revert changes
      execSync("git checkout .", { stdio: "pipe" });
      return {
        success: false,
        rootCause: diagnosis.rootCause,
        fixSummary: `Patch rejected: ${validation.reason}`,
        patchDiff: "",
        verificationLog: "",
        confidence: "low",
        routingDecision: context.routingDecision
      };
    }

    const fileValidation = validateDiffFiles(patchDiff, allowedFiles);
    if (!fileValidation.valid) {
      console.log(`   ⚠️  Patch file validation failed: ${fileValidation.reason}`);
      execSync("git checkout .", { stdio: "pipe" });
      return {
        success: false,
        rootCause: diagnosis.rootCause,
        fixSummary: `Patch rejected: ${fileValidation.reason}`,
        patchDiff: "",
        verificationLog: "",
        confidence: "low",
        routingDecision: context.routingDecision
      };
    }

    console.log(`   Patch size: ${patchDiff.split("\n").length} lines`);

    // ─────────────────────────────────────────────────────────────
    // PHASE 3: Verify Fix
    // ─────────────────────────────────────────────────────────────
    console.log("\n✅ Phase 3: Verifying fix...");

    if (!context.failedCommand || context.failedCommand === "unknown") {
      console.log("   ❌ Unable to determine failed command for verification");
      execSync("git checkout .", { stdio: "pipe" });
      return {
        success: false,
        rootCause: diagnosis.rootCause,
        fixSummary: "Fix generated but failed command could not be determined for verification",
        patchDiff,
        verificationLog: "Failed command could not be determined from logs or steps.",
        confidence: "low",
        routingDecision: context.routingDecision
      };
    }

    let verificationResult = await verifyFix(
      context.failedCommand,
      config.guardrails.allowed_commands,
      config.guardrails.max_runtime_seconds * 1000
    );

    // Retry if needed
    if (!verificationResult.passed && config.behavior.max_retries > 0) {
      console.log("   ⚠️  Verification failed, attempting retry...");

      for (let attempt = 1; attempt <= config.behavior.max_retries; attempt++) {
        await retryFix(verificationResult.output, attempt, allowedFiles);
        patchDiff = getCurrentDiff();

        const retryValidation = validatePatch(
          patchDiff,
          config.guardrails.max_diff_lines,
          config.guardrails.forbidden_patterns
        );

        if (!retryValidation.valid) {
          console.log(`   ⚠️  Retry patch validation failed: ${retryValidation.reason}`);
          continue;
        }

        const retryFileValidation = validateDiffFiles(patchDiff, allowedFiles);
        if (!retryFileValidation.valid) {
          console.log(`   ⚠️  Retry patch file validation failed: ${retryFileValidation.reason}`);
          continue;
        }

        verificationResult = await verifyFix(
          context.failedCommand,
          config.guardrails.allowed_commands,
          config.guardrails.max_runtime_seconds * 1000
        );

        if (verificationResult.passed) {
          console.log(`   ✅ Retry ${attempt} succeeded!`);
          break;
        }
      }
    }

    if (!verificationResult.passed && config.behavior.require_verification) {
      console.log("   ❌ Verification failed after retries");
      // Revert changes since verification failed
      execSync("git checkout .", { stdio: "pipe" });
      return {
        success: false,
        rootCause: diagnosis.rootCause,
        fixSummary: "Fix generated but verification failed",
        patchDiff: patchDiff,
        verificationLog: verificationResult.output,
        confidence: "low",
        routingDecision: context.routingDecision
      };
    }

    console.log("   ✅ Verification passed!");

    // ─────────────────────────────────────────────────────────────
    // PHASE 4: Generate RCA
    // ─────────────────────────────────────────────────────────────
    console.log("\n📋 Phase 4: Generating RCA...");

    const rca = await generateRCA(diagnosis, patchDiff, verificationResult, context);

    return {
      success: true,
      rootCause: diagnosis.rootCause,
      fixSummary: rca,
      patchDiff,
      verificationLog: verificationResult.output,
      confidence: diagnosis.confidence,
      routingDecision: context.routingDecision
    };

  } catch (error) {
    console.error("Triage agent error:", error);
    // Ensure we revert any partial changes
    try {
      execSync("git checkout .", { stdio: "pipe" });
    } catch {}

    return {
      success: false,
      rootCause: `Error during triage: ${error}`,
      fixSummary: "Agent encountered an error",
      patchDiff: "",
      verificationLog: "",
      confidence: "low",
      routingDecision: context.routingDecision
    };
  }
}

/**
 * Run diagnosis phase using OpenAI
 */
async function runDiagnosis(context: FailureContext): Promise<Diagnosis> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: PROMPTS.system },
      { role: "user", content: PROMPTS.diagnosis(context) }
    ],
    temperature: 0.2,
    max_tokens: 2000
  });

  const content = response.choices[0]?.message?.content || "";
  return parseDiagnosis(content);
}

/**
 * Generate fix using OpenAI with tool use for file editing
 */
async function generateFix(
  diagnosis: Diagnosis,
  guardrails: GreenlitConfig["guardrails"],
  allowedFiles: string[]
): Promise<void> {
  // Read the affected files first
  const fileContents: Record<string, string> = {};
  for (const file of diagnosis.affectedFiles) {
    if (!isAllowedFilePath(file, allowedFiles)) {
      console.log(`   Skipping unsafe or disallowed file read: ${file}`);
      continue;
    }
    try {
      const content = fs.readFileSync(file, "utf-8");
      fileContents[file] = content;
    } catch {
      console.log(`   Warning: Could not read ${file}`);
    }
  }

  const filesContext = Object.entries(fileContents)
    .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
    .join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: PROMPTS.system },
      {
        role: "user",
        content: `${PROMPTS.generateFix(diagnosis, guardrails)}\n\n## Current File Contents\n${filesContext}\n\nProvide the COMPLETE fixed file contents for each file that needs changes. Format as:\n\n### path/to/file.ts\n\`\`\`typescript\n// complete file content\n\`\`\``
      }
    ],
    temperature: 0.2,
    max_tokens: 4000
  });

  const content = response.choices[0]?.message?.content || "";

  // Parse and write the fixed files
  const filePattern = /###\s*([^\n]+)\n```[\w]*\n([\s\S]*?)```/g;
  let match;

  while ((match = filePattern.exec(content)) !== null) {
    const filePath = match[1].trim();
    const fileContent = match[2];

    if (!isAllowedFilePath(filePath, allowedFiles)) {
      console.log(`   Skipping unsafe or disallowed file update: ${filePath}`);
      continue;
    }

    try {
      fs.writeFileSync(filePath, fileContent);
      console.log(`   Updated: ${filePath}`);
    } catch (err) {
      console.log(`   Failed to write ${filePath}: ${err}`);
    }
  }
}

/**
 * Retry fix after verification failure
 */
async function retryFix(
  failureOutput: string,
  attempt: number,
  allowedFiles: string[]
): Promise<void> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: PROMPTS.system },
      { role: "user", content: PROMPTS.retryFix(failureOutput, attempt) }
    ],
    temperature: 0.3,
    max_tokens: 3000
  });

  const content = response.choices[0]?.message?.content || "";

  // Parse and apply any file updates
  const filePattern = /###\s*([^\n]+)\n```[\w]*\n([\s\S]*?)```/g;
  let match;

  while ((match = filePattern.exec(content)) !== null) {
    const filePath = match[1].trim();
    const fileContent = match[2];

    try {
      if (!isAllowedFilePath(filePath, allowedFiles)) {
        console.log(`   Skipping unsafe or disallowed retry update: ${filePath}`);
        continue;
      }
      fs.writeFileSync(filePath, fileContent);
      console.log(`   Retry updated: ${filePath}`);
    } catch (err) {
      console.log(`   Retry failed to write ${filePath}: ${err}`);
    }
  }
}

function normalizeAllowedFiles(files: string[]): string[] {
  const normalized = files
    .map(f => normalizeFilePath(f))
    .filter(f => f && f !== ".")
    .filter(f => isSafeRelativePath(f));
  return [...new Set(normalized)];
}

function normalizeFilePath(filePath: string): string {
  const trimmed = filePath.trim().replace(/\\/g, "/");
  const normalized = path.posix.normalize(trimmed);
  return normalized.replace(/^\.\/+/, "");
}

function isSafeRelativePath(filePath: string): boolean {
  if (!filePath || filePath === ".") return false;
  if (path.isAbsolute(filePath)) return false;
  const parts = filePath.split("/");
  return !parts.some(part => part === "..");
}

function isAllowedFilePath(filePath: string, allowedFiles: string[]): boolean {
  if (!allowedFiles.length) return false;
  const normalized = normalizeFilePath(filePath);
  if (!isSafeRelativePath(normalized)) return false;
  return allowedFiles.includes(normalized);
}

function extractDiffFiles(diff: string): {
  files: string[];
  hasDeletions: boolean;
  hasRenames: boolean;
} {
  const files = new Set<string>();
  let hasDeletions = false;
  let hasRenames = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      hasRenames = true;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") {
        hasDeletions = true;
        continue;
      }
      const cleaned = target.startsWith("b/") ? target.slice(2) : target;
      const normalized = normalizeFilePath(cleaned);
      if (normalized && normalized !== ".") {
        files.add(normalized);
      }
    }
  }

  return { files: [...files], hasDeletions, hasRenames };
}

function validateDiffFiles(diff: string, allowedFiles: string[]): { valid: boolean; reason?: string } {
  const { files, hasDeletions, hasRenames } = extractDiffFiles(diff);

  if (hasDeletions) {
    return { valid: false, reason: "Patch deletes files, which is not allowed" };
  }
  if (hasRenames) {
    return { valid: false, reason: "Patch renames files, which is not allowed" };
  }
  if (!files.length) {
    return { valid: true };
  }
  if (!allowedFiles.length) {
    return {
      valid: false,
      reason: "No allowed files were provided to validate patch paths"
    };
  }

  for (const file of files) {
    if (!isSafeRelativePath(file)) {
      return { valid: false, reason: `Unsafe file path detected: ${file}` };
    }
    if (!allowedFiles.includes(file)) {
      return { valid: false, reason: `Patch modifies disallowed file: ${file}` };
    }
  }

  return { valid: true };
}

/**
 * Generate RCA summary
 */
async function generateRCA(
  diagnosis: Diagnosis,
  patchDiff: string,
  verification: VerificationResult,
  context: FailureContext
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: PROMPTS.system },
      { role: "user", content: PROMPTS.generateRCA(diagnosis, patchDiff, verification, context) }
    ],
    temperature: 0.2,
    max_tokens: 1500
  });

  const candidate =
    response.choices[0]?.message?.content?.trim() ||
    diagnosis.suggestedFix ||
    "Fix applied";

  if (isValidRca(candidate)) {
    return candidate;
  }

  return buildRcaFallback(diagnosis, verification, context);
}

function isValidRca(content: string): boolean {
  const requiredHeadings = [
    "## Summary",
    "## Failure Signature",
    "## Root Cause",
    "## Fix Applied",
    "## Verification"
  ];

  return requiredHeadings.every(heading => {
    const pattern = new RegExp(`^${heading}\\b`, "mi");
    return pattern.test(content);
  });
}

function buildRcaFallback(
  diagnosis: Diagnosis,
  verification: VerificationResult,
  context: FailureContext
): string {
  const jobStep = [context.evidence?.job, context.evidence?.step].filter(Boolean).join(" / ");
  const errorLine = context.errorSignature.split("\n")[0]?.trim() || "Unknown error";
  const fixSummary = diagnosis.suggestedFix || "Applied minimal fix to address failure.";

  return `## Summary
Resolved the CI failure with a minimal targeted change.

## Failure Signature
- **Job/Step**: ${jobStep || "Unknown"}
- **Error**: ${errorLine}

## Root Cause
${diagnosis.rootCause || "Root cause could not be determined from available data."}

## Fix Applied
${fixSummary}

## Verification
- **Command**: \`${verification.command}\`
- **Result**: ${verification.passed ? "✅ PASSED" : "❌ FAILED"}
`;
}

/**
 * Generate report for non-fixable failures
 */
async function generateReportOnly(context: FailureContext): Promise<TriageResult> {
  console.log("\n📋 Generating report-only (no fix attempt)...");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: PROMPTS.system },
      { role: "user", content: PROMPTS.reportOnly(context) }
    ],
    temperature: 0.2,
    max_tokens: 1500
  });

  const report = response.choices[0]?.message?.content || "";

  return {
    success: false,
    rootCause: context.errorSignature,
    fixSummary: report,
    patchDiff: "",
    verificationLog: "",
    confidence: "high",
    routingDecision: "report_only"
  };
}

/**
 * Handle flaky test workflow
 */
async function handleFlakeWorkflow(context: FailureContext): Promise<TriageResult> {
  console.log("\n🎲 Handling flaky test workflow...");

  const report = `## Flaky Test Detected

### Error Signature
\`\`\`
${context.errorSignature}
\`\`\`

### Recommendation
This test appears to be flaky (intermittent failure). Recommended actions:
1. Quarantine the test temporarily
2. Investigate the root cause of flakiness
3. Consider adding retries or fixing timing issues

### Files Involved
${context.relevantFiles.map(f => `- ${f}`).join("\n")}

### Fingerprint
\`${context.fingerprint}\` (use for deduplication)
`;

  return {
    success: false,
    rootCause: "Flaky test detected",
    fixSummary: report,
    patchDiff: "",
    verificationLog: "",
    confidence: "medium",
    routingDecision: "flake_workflow"
  };
}
