import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import { resolveOwnerAssignment } from "./owner-routing.js";
import { getDefaultConfig } from "../config/greenlit.config.js";
import type { FailureContext } from "../collector/types.js";

function buildContext(overrides: Partial<FailureContext> = {}): FailureContext {
  return {
    runId: 1,
    repo: "owner/repo",
    branch: "main",
    sha: "abc123",
    workflowName: "CI",
    failureType: "test",
    failureClass: "deterministic",
    routingDecision: "fix_attempt",
    failedCommand: "npm test",
    errorSignature: "Error: failure",
    relevantFiles: ["src/foo.ts"],
    rawLogs: "",
    extractedErrors: [],
    evidence: {
      file: "src/foo.ts",
      line: "10",
      job: "test",
      step: "run tests"
    },
    changedFiles: [],
    recentCommits: [],
    fingerprint: "deadbeef",
    ...overrides
  };
}

describe("resolveOwnerAssignment", () => {
  it("uses CODEOWNERS matches when available", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "greenlit-codeowners-"));
    const codeownersPath = path.join(tempDir, "CODEOWNERS");
    fs.writeFileSync(codeownersPath, "src/* @team-a\n");

    const config = getDefaultConfig();
    config.owner_routing = {
      ...config.owner_routing,
      codeowners_paths: [codeownersPath],
      blame_depth: 0,
      team_map: {},
      fallback_owner: "unassigned"
    };

    const assignment = resolveOwnerAssignment(buildContext(), config);

    expect(assignment.source).toBe("codeowners");
    expect(assignment.owner).toContain("@team-a");
  });

  it("falls back to team map when CODEOWNERS is missing", () => {
    const config = getDefaultConfig();
    config.owner_routing = {
      ...config.owner_routing,
      codeowners_paths: ["/nonexistent/CODEOWNERS"],
      blame_depth: 0,
      team_map: {
        "src/": "team-beta"
      },
      fallback_owner: "unassigned"
    };

    const assignment = resolveOwnerAssignment(buildContext(), config);

    expect(assignment.source).toBe("team_map");
    expect(assignment.owner).toBe("team-beta");
  });
});
