import type { FailedJob } from "./types.js";

export interface EvidencePack {
  file?: string;
  line?: string;
  excerpt?: string;
  job?: string;
  step?: string;
}

const FILE_LINE_PATTERN =
  /([^\s:]+?\.(?:[jt]sx?|py|go|rs|java|cs|cpp|c|rb|php|kt|swift|scala)):(\d+)(?::\d+)?/g;

/**
 * Build a small evidence pack from logs and failed job metadata.
 */
export function buildEvidencePack(logs: string, failedJobs: FailedJob[]): EvidencePack {
  const evidence: EvidencePack = {};

  const logLines = logs.split("\n");
  const bestMatch = findBestFileLineMatch(logLines);
  if (bestMatch) {
    evidence.file = bestMatch.file;
    evidence.line = bestMatch.line;
  }

  const excerpt = extractExcerpt(logLines, bestMatch?.matchedText);
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

function findBestFileLineMatch(
  lines: string[]
): { file: string; line: string; matchedText: string } | undefined {
  const matches: Array<{ file: string; line: string; matchedText: string; score: number }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineMatches = [...line.matchAll(FILE_LINE_PATTERN)];
    if (!lineMatches.length) continue;

    const score = scoreEvidenceWindow(lines, i);
    for (const match of lineMatches) {
      matches.push({
        file: match[1],
        line: match[2],
        matchedText: match[0],
        score
      });
    }
  }

  if (!matches.length) return undefined;

  matches.sort((a, b) => b.score - a.score);
  return matches[0];
}

function scoreEvidenceWindow(lines: string[], index: number): number {
  const windowStart = Math.max(index - 2, 0);
  const windowEnd = Math.min(index + 3, lines.length);
  const window = lines.slice(windowStart, windowEnd).join("\n");
  const keywords = /(error|fail|failed|exception|traceback|panic)/gi;
  const matches = window.match(keywords);
  const keywordScore = matches ? matches.length : 0;
  return 1 + keywordScore;
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
