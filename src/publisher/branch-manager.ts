import { execSync } from "child_process";

/**
 * Create a new branch for the fix
 */
export async function createFixBranch(
  baseBranch: string,
  branchPrefix: string
): Promise<string> {
  const timestamp = Date.now();
  const shortId = Math.random().toString(36).substring(2, 8);
  const branchName = `${branchPrefix}-${timestamp}-${shortId}`;

  // Ensure we're on the latest base branch state
  try {
    execSync(`git fetch origin ${baseBranch}`, { stdio: "pipe" });
  } catch {
    // Fetch might fail in some CI environments, continue anyway
  }

  // Create and checkout new branch
  execSync(`git checkout -b ${branchName}`, { stdio: "pipe" });

  console.log(`   Created branch: ${branchName}`);
  return branchName;
}

/**
 * Commit changes with a message
 */
export async function commitChanges(message: string): Promise<string> {
  // Stage all changes
  execSync("git add -A", { stdio: "pipe" });

  // Check if there are changes to commit
  const status = execSync("git status --porcelain", { encoding: "utf-8" });
  if (!status.trim()) {
    throw new Error("No changes to commit");
  }

  // Commit with message
  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { stdio: "pipe" });

  // Get the commit SHA
  const sha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  console.log(`   Committed: ${sha.substring(0, 7)}`);

  return sha;
}

/**
 * Push branch to remote
 */
export async function pushBranch(branchName: string): Promise<void> {
  execSync(`git push -u origin ${branchName}`, { stdio: "pipe" });
  console.log(`   Pushed: ${branchName}`);
}

/**
 * Clean up by switching back to original branch
 */
export async function cleanupBranch(originalBranch: string): Promise<void> {
  try {
    execSync(`git checkout ${originalBranch}`, { stdio: "pipe" });
  } catch {
    // Best effort cleanup
  }
}

/**
 * Get current branch name
 */
export function getCurrentBranch(): string {
  return execSync("git branch --show-current", { encoding: "utf-8" }).trim();
}

/**
 * Check if branch exists remotely
 */
export function branchExistsRemotely(branchName: string): boolean {
  try {
    execSync(`git ls-remote --heads origin ${branchName}`, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete local branch
 */
export function deleteLocalBranch(branchName: string): void {
  try {
    execSync(`git branch -D ${branchName}`, { stdio: "pipe" });
  } catch {
    // Branch might not exist, ignore
  }
}
