import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { FailureContext, OwnerAssignment } from "../collector/types.js";
import type { GreenlitConfig } from "../config/greenlit.config.js";

interface CodeownerRule {
  pattern: string;
  owners: string[];
  regex: RegExp;
  sourcePath: string;
  lineNumber: number;
}

export function resolveOwnerAssignment(
  context: FailureContext,
  config: GreenlitConfig
): OwnerAssignment {
  const candidateFiles = buildCandidateFiles(context);
  const codeowners = loadCodeowners(config.owner_routing?.codeowners_paths || []);
  const blameDepth = config.owner_routing?.blame_depth ?? 1;

  const codeownersMatch = findCodeownersMatch(candidateFiles, codeowners);
  if (codeownersMatch) {
    return {
      owner: codeownersMatch.owners.join(" "),
      source: "codeowners",
      reason: `CODEOWNERS match: ${codeownersMatch.pattern} (${codeownersMatch.sourcePath}:${codeownersMatch.lineNumber})`,
      confidence: "high",
      candidates: codeownersMatch.owners,
      file: codeownersMatch.file
    };
  }

  const blame = resolveOwnerFromBlame(context, blameDepth);
  if (blame) {
    return {
      owner: blame.owner,
      source: "blame",
      reason: `git blame at ${blame.file}:${blame.line}`,
      confidence: "medium",
      file: blame.file,
      line: blame.line
    };
  }

  const teamMap = resolveOwnerFromTeamMap(candidateFiles, config);
  if (teamMap) {
    return {
      owner: teamMap.owner,
      source: "team_map",
      reason: `team map match: ${teamMap.prefix}`,
      confidence: "low",
      file: teamMap.file
    };
  }

  const lastCommit = resolveOwnerFromLastCommit(candidateFiles);
  if (lastCommit) {
    return {
      owner: lastCommit.owner,
      source: "last_commit",
      reason: `last commit on ${lastCommit.file}`,
      confidence: "low",
      file: lastCommit.file
    };
  }

  const fallback = config.owner_routing?.fallback_owner || "unassigned";
  return {
    owner: fallback,
    source: "fallback",
    reason: "fallback owner",
    confidence: "low"
  };
}

function buildCandidateFiles(context: FailureContext): string[] {
  const files = [
    context.evidence?.file,
    ...context.relevantFiles,
    ...context.changedFiles
  ].filter(Boolean) as string[];

  const normalized = files
    .map(file => normalizePath(file))
    .filter(Boolean);

  return [...new Set(normalized)];
}

function normalizePath(filePath: string): string {
  const cleaned = filePath.trim().replace(/\\/g, "/");
  const normalized = path.posix.normalize(cleaned).replace(/^\.\//, "");
  return normalized;
}

function loadCodeowners(paths: string[]): CodeownerRule[] {
  const locations = paths.length ? paths : ["CODEOWNERS", ".github/CODEOWNERS"];
  const rules: CodeownerRule[] = [];

  for (const filePath of locations) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i].trim();
      if (!raw || raw.startsWith("#")) continue;
      const parts = raw.split(/\s+/).filter(Boolean);
      const pattern = parts.shift();
      if (!pattern || parts.length === 0) continue;
      const regex = codeownersPatternToRegExp(pattern);
      rules.push({
        pattern,
        owners: parts,
        regex,
        sourcePath: filePath,
        lineNumber: i + 1
      });
    }
  }

  return rules;
}

function findCodeownersMatch(
  files: string[],
  rules: CodeownerRule[]
): (CodeownerRule & { file: string }) | undefined {
  for (const file of files) {
    let matched: CodeownerRule | undefined;
    for (const rule of rules) {
      if (rule.regex.test(file)) {
        matched = rule;
      }
    }
    if (matched) {
      return { ...matched, file };
    }
  }

  return undefined;
}

function codeownersPatternToRegExp(pattern: string): RegExp {
  let anchor = false;
  let cleaned = pattern.trim();

  if (cleaned.startsWith("/")) {
    anchor = true;
    cleaned = cleaned.replace(/^\/+/, "");
  }

  if (cleaned.endsWith("/")) {
    cleaned = `${cleaned}**`;
  }

  const regexBody = globToRegex(cleaned);
  const prefix = anchor ? "^" : "(^|.*/)";
  return new RegExp(`${prefix}${regexBody}$`);
}

function globToRegex(glob: string): string {
  let regex = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    const next = glob[i + 1];

    if (char === "*" && next === "*") {
      regex += ".*";
      i += 1;
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += ".";
      continue;
    }

    if (".+^${}()|[]\\".includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }

  return regex;
}

function resolveOwnerFromBlame(
  context: FailureContext,
  depth: number
): { owner: string; file: string; line: string } | null {
  const file = context.evidence?.file;
  const lineRaw = context.evidence?.line;
  if (!file || !lineRaw) return null;

  const lineNumber = parseLineNumber(lineRaw);
  if (!lineNumber || depth <= 0) return null;

  const candidates = buildLineCandidates(lineNumber, depth);
  for (const candidateLine of candidates) {
    try {
      const output = execSync(`git blame -L ${candidateLine},${candidateLine} --porcelain -- ${file}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      });
      const author = extractBlameField(output, "author");
      const email = extractBlameField(output, "author-mail");
      if (!author) continue;
      const owner = email ? `${author} ${email}` : author;
      return { owner, file, line: String(candidateLine) };
    } catch {
      continue;
    }
  }

  return null;
}

function extractBlameField(output: string, field: string): string | null {
  const line = output.split("\n").find(l => l.startsWith(`${field} `));
  if (!line) return null;
  return line.slice(field.length + 1).trim();
}

function parseLineNumber(line: string): number | null {
  const match = line.match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildLineCandidates(lineNumber: number, depth: number): number[] {
  const candidates: number[] = [lineNumber];
  for (let offset = 1; offset < depth; offset += 1) {
    const lower = lineNumber - offset;
    const upper = lineNumber + offset;
    if (lower > 0) candidates.push(lower);
    candidates.push(upper);
  }
  return candidates;
}

function resolveOwnerFromTeamMap(
  files: string[],
  config: GreenlitConfig
): { owner: string; prefix: string; file: string } | null {
  const map = config.owner_routing?.team_map || {};
  const prefixes = Object.keys(map);
  if (!prefixes.length) return null;

  let best: { owner: string; prefix: string; file: string } | null = null;
  for (const file of files) {
    for (const prefix of prefixes) {
      const normalizedPrefix = normalizePath(prefix).replace(/\/$/, "");
      if (!normalizedPrefix) continue;
      if (file.startsWith(normalizedPrefix)) {
        if (!best || normalizedPrefix.length > best.prefix.length) {
          best = { owner: map[prefix], prefix: normalizedPrefix, file };
        }
      }
    }
  }

  return best;
}

function resolveOwnerFromLastCommit(
  files: string[]
): { owner: string; file: string } | null {
  for (const file of files) {
    try {
      const output = execSync(`git log -1 --format="%an <%ae>" -- ${file}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      if (output) {
        return { owner: output, file };
      }
    } catch {
      continue;
    }
  }

  return null;
}
