import { Octokit } from "@octokit/rest";
import type { WorkflowRunContext, FailedJob, FailedStep } from "./types.js";

/**
 * Collect failure context from a GitHub Actions workflow run
 */
export async function collectFailureContext(
  octokit: Octokit,
  runId: number,
  owner: string,
  repo: string
): Promise<WorkflowRunContext> {
  // 1. Get workflow run details
  const { data: run } = await octokit.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: runId
  });

  // 2. Get jobs for this run
  const { data: jobsResponse } = await octokit.rest.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
    filter: "latest"
  });

  // 3. Filter to failed jobs and fetch logs
  const failedJobs: FailedJob[] = [];

  for (const job of jobsResponse.jobs.filter(j => j.conclusion === "failure")) {
    const logs = await fetchJobLogs(octokit, owner, repo, job.id);
    const failedSteps: FailedStep[] = (job.steps || [])
      .filter(s => s.conclusion === "failure")
      .map(s => ({
        stepName: s.name,
        conclusion: s.conclusion || "unknown",
        startedAt: s.started_at || "",
        completedAt: s.completed_at || ""
      }));

    failedJobs.push({
      jobId: job.id,
      jobName: job.name,
      failedSteps,
      logs: truncateLogs(logs, 15000) // Keep last 15k chars
    });
  }

  return {
    runId,
    repo: { owner, repo },
    headSha: run.head_sha,
    headBranch: run.head_branch || "unknown",
    workflowName: run.name || "CI",
    failedJobs
  };
}

/**
 * Fetch logs for a specific job
 */
async function fetchJobLogs(
  octokit: Octokit,
  owner: string,
  repo: string,
  jobId: number
): Promise<string> {
  try {
    const { data } = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: jobId
    });
    return data as unknown as string;
  } catch (error) {
    console.warn(`Failed to fetch logs for job ${jobId}:`, error);
    return "";
  }
}

/**
 * Truncate logs to keep the most relevant (last) portion
 */
function truncateLogs(logs: string, maxChars: number): string {
  if (logs.length <= maxChars) return logs;
  return "... [truncated] ...\n" + logs.slice(-maxChars);
}

/**
 * Get workflow run annotations (errors, warnings)
 */
export async function getRunAnnotations(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number
): Promise<Array<{ level: string; message: string; path?: string; line?: number }>> {
  try {
    const { data: checkRuns } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: `refs/heads/main`, // Will need to parameterize
      filter: "latest"
    });

    const annotations: Array<{ level: string; message: string; path?: string; line?: number }> = [];

    for (const checkRun of checkRuns.check_runs) {
      if (checkRun.output?.annotations_count && checkRun.output.annotations_count > 0) {
        const { data: details } = await octokit.rest.checks.listAnnotations({
          owner,
          repo,
          check_run_id: checkRun.id
        });

        for (const annotation of details) {
          annotations.push({
            level: annotation.annotation_level || "warning",
            message: annotation.message,
            path: annotation.path,
            line: annotation.start_line
          });
        }
      }
    }

    return annotations;
  } catch (error) {
    console.warn("Failed to fetch annotations:", error);
    return [];
  }
}
