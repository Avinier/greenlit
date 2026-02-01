import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { FailureContext, MemorySummary } from "../collector/types.js";
import type { GreenlitConfig } from "../config/greenlit.config.js";

export type SignatureOutcome = "fix" | "report-only" | "quarantine" | "failed";

export interface SignatureRecord {
  signature: string;
  attempts: number;
  lastSeen: string;
  lastOutcome: SignatureOutcome;
  lastOwner?: string;
  lastResolution?: string;
  threadUrl?: string;
}

export interface SignatureLedger {
  records: Record<string, SignatureRecord>;
}

export function computeSignature(context: FailureContext): string {
  const normalizedError = normalizeErrorSignature(context.errorSignature);
  const payload = [
    context.repo,
    context.failureType,
    normalizedError,
    context.failedCommand,
    context.evidence?.job || "",
    context.evidence?.step || ""
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}

function normalizeErrorSignature(signature: string): string {
  return signature
    .replace(/\d+/g, "N") // Replace numbers
    .replace(/0x[a-f0-9]+/gi, "X") // Replace hex addresses
    .replace(/\/[\w\-\.\/]+\//g, "/PATH/") // Replace paths
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function loadSignatureLedger(filePath: string): SignatureLedger {
  try {
    if (!fs.existsSync(filePath)) {
      return { records: {} };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as SignatureLedger;
    return parsed.records ? parsed : { records: {} };
  } catch {
    return { records: {} };
  }
}

export function saveSignatureLedger(filePath: string, ledger: SignatureLedger): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(ledger, null, 2));
}

export function pruneExpiredSignatures(ledger: SignatureLedger, ttlDays: number): void {
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
  for (const [signature, record] of Object.entries(ledger.records)) {
    const lastSeen = Date.parse(record.lastSeen);
    if (Number.isNaN(lastSeen) || lastSeen < cutoff) {
      delete ledger.records[signature];
    }
  }
}

export function shouldAttemptSignature(
  signature: string,
  ledger: SignatureLedger,
  config: GreenlitConfig
): { allowed: boolean; reason?: string; record?: SignatureRecord } {
  pruneExpiredSignatures(ledger, config.signature_ledger.ttl_days);

  const record = ledger.records[signature];
  if (!record) {
    return { allowed: true };
  }

  if (record.attempts >= config.routing.max_attempts_per_signature) {
    return {
      allowed: false,
      reason: `Signature ${signature.slice(0, 8)} exceeded max attempts (${record.attempts})`,
      record
    };
  }

  if (record.lastOutcome === "report-only" || record.lastOutcome === "quarantine") {
    return {
      allowed: false,
      reason: `Signature ${signature.slice(0, 8)} previously routed to ${record.lastOutcome}`,
      record
    };
  }

  return { allowed: true, record };
}

export function updateSignatureLedger(
  signature: string,
  ledger: SignatureLedger,
  outcome: SignatureOutcome,
  details?: { owner?: string; resolution?: string; threadUrl?: string }
): void {
  const now = new Date().toISOString();
  const record = ledger.records[signature] || {
    signature,
    attempts: 0,
    lastSeen: now,
    lastOutcome: outcome
  };

  record.attempts += 1;
  record.lastSeen = now;
  record.lastOutcome = outcome;
  if (details?.owner) {
    record.lastOwner = details.owner;
  }
  if (details?.resolution) {
    record.lastResolution = details.resolution;
  }
  if (details?.threadUrl) {
    record.threadUrl = details.threadUrl;
  }

  ledger.records[signature] = record;
}

export function getSignatureMemory(record?: SignatureRecord): MemorySummary {
  if (!record) {
    return { seenBefore: false };
  }

  return {
    seenBefore: true,
    lastSeen: record.lastSeen,
    lastOutcome: record.lastOutcome,
    lastOwner: record.lastOwner,
    lastResolution: record.lastResolution,
    threadUrl: record.threadUrl
  };
}
