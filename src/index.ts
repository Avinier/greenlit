#!/usr/bin/env node
import { Command } from "commander";
import { Octokit } from "@octokit/rest";
import chalk from "chalk";
import * as fs from "fs";

import { collectFailureContext } from "./collector/github-logs.js";
import { buildFailureContext } from "./collector/context-builder.js";
import { runTriageAgent } from "./agent/orchestrator.js";
import { routeFailure } from "./agent/routing.js";
import {
  computeSignature,
  loadSignatureLedger,
  getSignatureMemory,
  saveSignatureLedger,
  shouldAttemptSignature,
  updateSignatureLedger
} from "./agent/signatures.js";
import { resolveOwnerAssignment } from "./agent/owner-routing.js";
import { buildFailureCard } from "./agent/failure-card.js";
import { createFixBranch, commitChanges, pushBranch, getCurrentBranch, cleanupBranch } from "./publisher/branch-manager.js";
import { createPullRequest, postComment, formatRCAMarkdown } from "./publisher/pr-creator.js";
import { loadConfig } from "./config/greenlit.config.js";
import type { TriageResult, FailureContext } from "./collector/types.js";

const program = new Command();

program
  .name("greenlit")
  .description("🤖 CI incident response agent for failed workflows")
  .version("0.1.0");

// ─────────────────────────────────────────────────────────────
// TRIAGE command - main entry point
// ─────────────────────────────────────────────────────────────
program
  .command("triage")
  .description("Analyze a CI failure and produce an incident card")
  .requiredOption("--run-id <id>", "GitHub Actions run ID")
  .requiredOption("--repo <owner/repo>", "Repository in owner/repo format")
  .requiredOption("--branch <branch>", "Branch name")
  .requiredOption("--sha <sha>", "Commit SHA")
  .option("--output <file>", "Output file for results", "greenlit-result.json")
  .option("--config <file>", "Config file path", "greenlit.yml")
  .option("--dry-run", "Run without creating PR")
  .action(async (options) => {
    console.log(chalk.green("\n🤖 Greenlit CI Triage Agent\n"));

    try {
      // Validate environment
      if (!process.env.GITHUB_TOKEN) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY environment variable is required");
      }

      // Load configuration
      const config = loadConfig(options.config);
      const [owner, repo] = options.repo.split("/");

      if (!owner || !repo) {
        throw new Error("Invalid repo format. Use owner/repo");
      }

      const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

      // ─────────────────────────────────────────────────────────────
      // Step 1: Collect failure context
      // ─────────────────────────────────────────────────────────────
      console.log(chalk.blue("📥 Collecting failure context..."));

      const runContext = await collectFailureContext(
        octokit,
        parseInt(options.runId),
        owner,
        repo
      );

      if (runContext.failedJobs.length === 0) {
        console.log(chalk.yellow("⚠️  No failed jobs found in this run"));
        process.exit(0);
      }

      const context = await buildFailureContext(runContext);
      context.routingDecision = routeFailure(context, config);
      const signature = computeSignature(context);
      const ownerAssignment = resolveOwnerAssignment(context, config);

      console.log(chalk.gray(`   Failure Type: ${context.failureType}`));
      console.log(chalk.gray(`   Failure Class: ${context.failureClass}`));
      console.log(chalk.gray(`   Routing: ${context.routingDecision}`));
      console.log(chalk.gray(`   Error: ${context.errorSignature.slice(0, 80)}...`));

      const ledger = loadSignatureLedger(config.signature_ledger.path);
      const signatureCheck = shouldAttemptSignature(signature, ledger, config);
      const memory = getSignatureMemory(signatureCheck.record);
      if (!signatureCheck.allowed) {
        console.log(chalk.yellow(`⚠️  Skipping fix attempt: ${signatureCheck.reason}`));
        updateSignatureLedger(signature, ledger, "report-only", {
          owner: ownerAssignment.owner,
          resolution: signatureCheck.reason || "Signature attempt blocked"
        });
        saveSignatureLedger(config.signature_ledger.path, ledger);

        const result: TriageResult = {
          success: false,
          rootCause: context.errorSignature,
          fixSummary: signatureCheck.reason || "Signature attempt blocked",
          patchDiff: "",
          verificationLog: "",
          confidence: "medium",
          routingDecision: "report_only" as const,
          ownerAssignment,
          memory
        };
        result.failureCard = buildFailureCard(context, result, ownerAssignment, memory);

        const output = {
          success: result.success,
          signature,
          context: {
            runId: context.runId,
            repo: context.repo,
            branch: context.branch,
            sha: context.sha,
            workflowName: context.workflowName,
            failureType: context.failureType,
            failureClass: context.failureClass,
            routingDecision: context.routingDecision,
            failedCommand: context.failedCommand,
            errorSignature: context.errorSignature,
            relevantFiles: context.relevantFiles,
            fingerprint: context.fingerprint,
            evidence: context.evidence
          },
          result,
          timestamp: new Date().toISOString()
        };

        fs.writeFileSync(options.output, JSON.stringify(output, null, 2));
        const rcaPath = options.output.replace(".json", "-rca.md");
        fs.writeFileSync(rcaPath, formatRCAMarkdown(result, context));
        process.exit(1);
      }

      // ─────────────────────────────────────────────────────────────
      // Step 2: Run triage agent
      // ─────────────────────────────────────────────────────────────
      console.log(chalk.blue("\n🤖 Running triage agent..."));

      const result = await runTriageAgent(context, config);
      result.ownerAssignment = ownerAssignment;
      result.memory = memory;
      result.failureCard = buildFailureCard(context, result, ownerAssignment, memory);
      const outcome =
        result.routingDecision === "report_only"
          ? "report-only"
          : result.routingDecision === "flake_workflow"
          ? "quarantine"
          : result.success
          ? "fix"
          : "failed";
      updateSignatureLedger(signature, ledger, outcome, {
        owner: ownerAssignment.owner,
        resolution: result.fixSummary
      });
      saveSignatureLedger(config.signature_ledger.path, ledger);

      // ─────────────────────────────────────────────────────────────
      // Step 3: Write result
      // ─────────────────────────────────────────────────────────────
      const output = {
        success: result.success,
        signature,
          context: {
            runId: context.runId,
            repo: context.repo,
            branch: context.branch,
            sha: context.sha,
            workflowName: context.workflowName,
            failureType: context.failureType,
            failureClass: context.failureClass,
            routingDecision: context.routingDecision,
            failedCommand: context.failedCommand,
            errorSignature: context.errorSignature,
            relevantFiles: context.relevantFiles,
            fingerprint: context.fingerprint,
            evidence: context.evidence
          },
          result: {
            rootCause: result.rootCause,
            fixSummary: result.fixSummary,
            confidence: result.confidence,
            routingDecision: result.routingDecision,
            patchDiff: result.patchDiff,
            verificationLog: result.verificationLog,
            ownerAssignment: result.ownerAssignment,
            memory: result.memory,
            failureCard: result.failureCard
          },
          timestamp: new Date().toISOString()
        };

      fs.writeFileSync(options.output, JSON.stringify(output, null, 2));
      console.log(chalk.gray(`\n📄 Result written to ${options.output}`));

      // Also write RCA markdown
      const rcaPath = options.output.replace(".json", "-rca.md");
      fs.writeFileSync(rcaPath, formatRCAMarkdown(result, context));
      console.log(chalk.gray(`📋 RCA written to ${rcaPath}`));

      // ─────────────────────────────────────────────────────────────
      // Step 4: Summary
      // ─────────────────────────────────────────────────────────────
      if (result.success) {
        console.log(chalk.green("\n✅ Fix generated successfully!"));
        console.log(chalk.gray(`   Confidence: ${result.confidence}`));
        if (!options.dryRun) {
          console.log(chalk.gray("   Run 'greenlit publish' to create PR"));
        }
      } else {
        console.log(chalk.yellow("\n⚠️  Analysis complete (no automated fix applied)"));
        console.log(chalk.gray(`   Summary: ${result.fixSummary.slice(0, 100)}...`));
      }

      process.exit(result.success ? 0 : 1);

    } catch (error) {
      console.error(chalk.red("\n❌ Error:"), error);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────
// PUBLISH command - create PR from triage result
// ─────────────────────────────────────────────────────────────
program
  .command("publish")
  .description("Publish a failure card or optional PR")
  .requiredOption("--result <file>", "Result JSON file from triage")
  .requiredOption("--base-branch <branch>", "Base branch for PR")
  .option("--config <file>", "Config file path", "greenlit.yml")
  .option("--comment-only", "Only post comment, don't create PR")
  .action(async (options) => {
    console.log(chalk.green("\n🚀 Greenlit PR Publisher\n"));

    try {
      // Validate environment
      if (!process.env.GITHUB_TOKEN) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }

      // Load result
      if (!fs.existsSync(options.result)) {
        throw new Error(`Result file not found: ${options.result}`);
      }

      const data = JSON.parse(fs.readFileSync(options.result, "utf-8"));
      const result: TriageResult = data.result;
      const contextData = data.context || {};
      const context: FailureContext = {
        runId: contextData.runId ?? 0,
        repo: contextData.repo ?? "unknown/unknown",
        branch: contextData.branch ?? "unknown",
        sha: contextData.sha ?? "unknown",
        workflowName: contextData.workflowName ?? "CI",
        failureType: contextData.failureType ?? "unknown",
        failureClass: contextData.failureClass ?? "unknown",
        routingDecision: contextData.routingDecision ?? result.routingDecision ?? "report_only",
        failedCommand: contextData.failedCommand ?? "unknown",
        errorSignature: contextData.errorSignature ?? result.rootCause.split("\n")[0],
        relevantFiles: contextData.relevantFiles ?? [],
        rawLogs: "",
        extractedErrors: [],
        changedFiles: [],
        recentCommits: [],
        fingerprint: contextData.fingerprint ?? "unknown",
        evidence: contextData.evidence
      };

      const config = loadConfig(options.config);
      const commentOnly = options.commentOnly || !config.behavior.auto_pr;
      const [owner, repo] = context.repo.split("/");
      const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

      if (!result.failureCard) {
        result.failureCard = buildFailureCard(
          context,
          result,
          result.ownerAssignment,
          result.memory
        );
      }

      if (commentOnly) {
        await postComment(octokit, owner, repo, context, result);
        console.log(chalk.green("✅ Comment posted"));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.log(chalk.yellow("⚠️  No successful fix to publish"));
        await postComment(octokit, owner, repo, context, result);
        process.exit(1);
      }

      // ─────────────────────────────────────────────────────────────
      // Create branch and PR
      // ─────────────────────────────────────────────────────────────
      console.log(chalk.blue("🌿 Creating fix branch..."));

      const originalBranch = getCurrentBranch();
      const branchName = await createFixBranch(
        options.baseBranch,
        config.output.branch_prefix
      );

      console.log(chalk.blue("💾 Committing changes..."));

      const commitMessage = `fix(greenlit): ${context.failureType} - ${result.rootCause.split("\n")[0].slice(0, 50)}

${result.fixSummary.slice(0, 500)}

Fingerprint: ${context.fingerprint}
Generated by Greenlit`;

      await commitChanges(commitMessage);

      console.log(chalk.blue("📤 Pushing branch..."));
      await pushBranch(branchName);

      console.log(chalk.blue("🔀 Creating pull request..."));

      const prDetails = await createPullRequest(
        octokit,
        owner,
        repo,
        options.baseBranch,
        branchName,
        result,
        context,
        config.output.pr_title_template
      );

      // Post comment on original commit/PR
      await postComment(octokit, owner, repo, context, result, prDetails);

      // Cleanup
      await cleanupBranch(originalBranch);

      console.log(chalk.green(`\n✅ PR created: ${prDetails.prUrl}`));

    } catch (error) {
      console.error(chalk.red("\n❌ Error:"), error);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────
// ANALYZE command - quick local analysis
// ─────────────────────────────────────────────────────────────
program
  .command("analyze")
  .description("Analyze local test/build failures")
  .option("--command <cmd>", "Command that failed", "npm test")
  .option("--logs <file>", "Log file to analyze")
  .option("--config <file>", "Config file path", "greenlit.yml")
  .action(async (options) => {
    console.log(chalk.green("\n🔍 Greenlit Local Analyzer\n"));

    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY environment variable is required");
      }

      const config = loadConfig(options.config);

      // Get logs from file or run the command
      let logs = "";
      if (options.logs && fs.existsSync(options.logs)) {
        logs = fs.readFileSync(options.logs, "utf-8");
      } else {
        console.log(chalk.blue(`Running: ${options.command}`));
        const { execSync } = await import("child_process");
        try {
          logs = execSync(options.command, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
          console.log(chalk.green("✅ Command passed - no failures to analyze"));
          process.exit(0);
        } catch (error: unknown) {
          const execError = error as { stdout?: string; stderr?: string };
          logs = (execError.stdout || "") + "\n" + (execError.stderr || "");
        }
      }

      // Build a minimal context
      const context: FailureContext = {
        runId: 0,
        repo: "local/repo",
        branch: "local",
        sha: "local",
        workflowName: "local",
        failureType: "unknown",
        failureClass: "deterministic",
        routingDecision: "fix_attempt",
        failedCommand: options.command,
        errorSignature: logs.split("\n").find(l => /error|fail/i.test(l)) || "Unknown error",
        relevantFiles: [],
        rawLogs: logs,
        extractedErrors: [],
        changedFiles: [],
        recentCommits: [],
        fingerprint: "local"
      };

      // Run the agent
      const result = await runTriageAgent(context, config);

      if (result.success) {
        console.log(chalk.green("\n✅ Fix applied!"));
        console.log(chalk.gray("Run your tests again to verify."));
      } else {
        console.log(chalk.yellow("\n⚠️  Analysis complete (no fix applied)"));
        console.log(chalk.gray(result.fixSummary));
      }

    } catch (error) {
      console.error(chalk.red("\n❌ Error:"), error);
      process.exit(1);
    }
  });

// Parse and run
program.parse();
