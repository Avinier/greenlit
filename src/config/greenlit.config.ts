import { z } from "zod";
import * as fs from "fs";
import * as yaml from "yaml";

// Zod schema for configuration validation
const GuardrailsSchema = z.object({
  max_diff_lines: z.number().default(200),
  max_runtime_seconds: z.number().default(300),
  allowed_commands: z.array(z.string()).default([
    "npm test",
    "npm run lint",
    "npm run build",
    "npm run typecheck"
  ]),
  forbidden_patterns: z.array(z.string()).default([
    "*.env*",
    "*secret*",
    "package-lock.json",
    "yarn.lock"
  ])
});

const BehaviorSchema = z.object({
  auto_pr: z.boolean().default(true),
  require_verification: z.boolean().default(true),
  max_retries: z.number().default(1),
  failure_types: z.array(z.enum(["test", "lint", "typecheck", "build"])).default([
    "test", "lint", "typecheck", "build"
  ])
});

const RoutingSchema = z.object({
  report_only: z.array(z.string()).default([
    "secrets", "permissions", "infra_outage", "dependency_registry"
  ]),
  fix_attempt: z.array(z.string()).default([
    "test", "lint", "typecheck", "build"
  ]),
  flake_workflow: z.array(z.string()).default(["flaky"])
});

const OutputSchema = z.object({
  pr_title_template: z.string().default("fix(greenlit): {failure_type} - {summary}"),
  branch_prefix: z.string().default("greenlit/fix")
});

const ConfigSchema = z.object({
  version: z.number().default(1),
  guardrails: GuardrailsSchema.default({}),
  behavior: BehaviorSchema.default({}),
  routing: RoutingSchema.default({}),
  output: OutputSchema.default({})
});

export type GreenlitConfig = z.infer<typeof ConfigSchema>;
export type Guardrails = z.infer<typeof GuardrailsSchema>;
export type Behavior = z.infer<typeof BehaviorSchema>;
export type Routing = z.infer<typeof RoutingSchema>;
export type Output = z.infer<typeof OutputSchema>;

/**
 * Load and validate configuration from a YAML file
 */
export function loadConfig(configPath: string = "greenlit.yml"): GreenlitConfig {
  try {
    if (!fs.existsSync(configPath)) {
      console.log(`Config file not found at ${configPath}, using defaults`);
      return ConfigSchema.parse({});
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = yaml.parse(content);
    return ConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Configuration validation error:");
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      throw new Error("Invalid configuration");
    }
    throw error;
  }
}

/**
 * Get default configuration
 */
export function getDefaultConfig(): GreenlitConfig {
  return ConfigSchema.parse({});
}
