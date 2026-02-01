import type { FailedJob } from "./types.js";

export interface EvidencePack {
  file?: string;
  line?: string;
  excerpt?: string;
  job?: string;
  step?: string;
}

const FILE_LINE_PATTERN =
  /([^\s:]+?\.(?:[jt]sx?|py|go|rs|java|cs|cpp|c|rb|php|kt|swift|scala)):(\d+)(?::\d+)?/;

/**
 * Build a small evidence pack from logs and failed job metadata.
 */
export function buildEvidencePack(logs: string, failedJobs: FailedJob[]): EvidencePack {
  const evidence: EvidencePack = {};

  const match = logs.match(FILE_LINE_PATTERN);
  if (match) {
    evidence.file = match[1];
    evidence.line = match[2];
  }

  const logLines = logs.split("\n");
  const excerpt = extractExcerpt(logLines, match?.[0]);
  if (excerpt) {
    evidence.excerpt = excerpt;
  }

  const failingJob = failedJobs[0];
  if (failingJob) {
    evidence.job = failingJob.jobName;
    evidence.step = failingJob.failedSteps[0]?.stepName;
  }

  return evidence;
}

function extractExcerpt(lines: string[], matchedLine?: string): string | undefined {
  if (!lines.length) return undefined;

  if (matchedLine) {
    const index = lines.findIndex(line => line.includes(matchedLine));
    if (index >= 0) {
      const start = Math.max(index - 5, 0);
      const end = Math.min(index + 6, lines.length);
      return lines.slice(start, end).join("\n");
    }
  }

  return lines.slice(Math.max(lines.length - 10, 0)).join("\n");
}
