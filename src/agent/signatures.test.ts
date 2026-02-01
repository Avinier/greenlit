import { describe, it, expect } from "vitest";
import { getSignatureMemory, setSignatureThread } from "./signatures.js";
import type { SignatureLedger } from "./signatures.js";


describe("signature ledger thread tracking", () => {
  it("stores thread URL without altering attempts", () => {
    const ledger: SignatureLedger = {
      records: {
        sig: {
          signature: "sig",
          attempts: 2,
          lastSeen: "2025-01-01T00:00:00.000Z",
          lastOutcome: "fix"
        }
      }
    };

    setSignatureThread("sig", ledger, "https://example.com/thread");

    expect(ledger.records.sig.threadUrl).toBe("https://example.com/thread");
    expect(ledger.records.sig.attempts).toBe(2);

    const memory = getSignatureMemory(ledger.records.sig);
    expect(memory.seenBefore).toBe(true);
    expect(memory.threadUrl).toBe("https://example.com/thread");
  });

  it("ignores thread updates for unknown signatures", () => {
    const ledger: SignatureLedger = { records: {} };

    setSignatureThread("missing", ledger, "https://example.com/thread");

    expect(Object.keys(ledger.records).length).toBe(0);
  });
});
