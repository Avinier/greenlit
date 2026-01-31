import { execSync, ExecSyncOptions } from "child_process";
import type { VerificationResult } from "../collector/types.js";

/**
 * Verify a fix by running the failing command
 */
export async function verifyFix(
  originalCommand: string,
  allowedCommands: string[],
  timeoutMs: number = 120000
): Promise<VerificationResult> {
  // Validate command is in allowlist
  const command = findAllowedCommand(originalCommand, allowedCommands);

  if (!command) {
    return {
      passed: false,
      command: originalCommand,
      output: `Command not in allowlist: ${originalCommand}\nAllowed commands: ${allowedCommands.join(", ")}`,
      exitCode: -1
    };
  }

  console.log(`  Running verification: ${command}`);

  try {
    const options: ExecSyncOptions = {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      stdio: ["pipe", "pipe", "pipe"]
    };

    const output = execSync(command, options) as string;

    return {
      passed: true,
      command,
      output: output.slice(-5000), // Keep last 5k chars
      exitCode: 0
    };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    const stdout = execError.stdout || "";
    const stderr = execError.stderr || "";
    const output = `${stdout}\n${stderr}`.slice(-5000);

    return {
      passed: false,
      command,
      output,
      exitCode: execError.status || 1
    };
  }
}

/**
 * Find an allowed command that matches the original
 */
function findAllowedCommand(original: string, allowed: string[]): string | null {
  const normalizedOriginal = original.trim().toLowerCase();

  // Direct match
  for (const pattern of allowed) {
    if (normalizedOriginal === pattern.toLowerCase()) {
      return pattern;
    }
  }

  // Prefix match (e.g., "npm test" matches "npm test -- --coverage")
  for (const pattern of allowed) {
    if (normalizedOriginal.startsWith(pattern.toLowerCase())) {
      return pattern;
    }
  }

  // Base command match (e.g., "npm" from "npm test")
  for (const pattern of allowed) {
    const baseCmd = pattern.split(" ")[0];
    const originalBase = normalizedOriginal.split(" ")[0];
    if (originalBase === baseCmd.toLowerCase()) {
      return pattern; // Use the allowed version for safety
    }
  }

  return null;
}

/**
 * Run a broader test suite to ensure no regressions
 */
export async function runBroaderVerification(
  commands: string[],
  allowedCommands: string[],
  timeoutMs: number = 180000
): Promise<{ allPassed: boolean; results: VerificationResult[] }> {
  const results: VerificationResult[] = [];
  let allPassed = true;

  for (const cmd of commands) {
    const result = await verifyFix(cmd, allowedCommands, timeoutMs);
    results.push(result);
    if (!result.passed) {
      allPassed = false;
    }
  }

  return { allPassed, results };
}

/**
 * Validate that a patch is safe to apply
 */
export function validatePatch(
  diff: string,
  maxLines: number,
  forbiddenPatterns: string[]
): { valid: boolean; reason?: string } {
  // Check diff size
  const lines = diff.split("\n");
  const changedLines = lines.filter(l => l.startsWith("+") || l.startsWith("-")).length;

  if (changedLines > maxLines) {
    return {
      valid: false,
      reason: `Patch too large: ${changedLines} lines changed (max: ${maxLines})`
    };
  }

  // Check for forbidden patterns
  for (const pattern of forbiddenPatterns) {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"), "i");
    if (regex.test(diff)) {
      return {
        valid: false,
        reason: `Patch modifies forbidden pattern: ${pattern}`
      };
    }
  }

  // Check for potential secrets
  const secretPatterns = [
    /api[_-]?key\s*[:=]/i,
    /secret\s*[:=]/i,
    /password\s*[:=]/i,
    /token\s*[:=]/i,
    /credential/i,
    /private[_-]?key/i
  ];

  for (const pattern of secretPatterns) {
    if (pattern.test(diff)) {
      return {
        valid: false,
        reason: `Patch may contain sensitive data matching: ${pattern}`
      };
    }
  }

  return { valid: true };
}

/**
 * Get the current diff of changes
 */
export function getCurrentDiff(): string {
  try {
    return execSync("git diff", { encoding: "utf-8" });
  } catch {
    return "";
  }
}

/**
 * Get staged changes diff
 */
export function getStagedDiff(): string {
  try {
    return execSync("git diff --staged", { encoding: "utf-8" });
  } catch {
    return "";
  }
}

/**
 * Check if there are uncommitted changes
 */
export function hasUncommittedChanges(): boolean {
  try {
    const status = execSync("git status --porcelain", { encoding: "utf-8" });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}
