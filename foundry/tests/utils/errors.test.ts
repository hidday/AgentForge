import { describe, it, expect } from "vitest";
import {
  PolicyViolationError,
  PolicyError,
  ValidationError,
  AgentTimeoutError,
  OutputParseError,
  StateTransitionError,
  PreflightError,
  type PreflightSummary,
} from "../../src/utils/errors.js";

describe("PolicyViolationError", () => {
  it("sets message, rule, and name", () => {
    const err = new PolicyViolationError("file not allowed", "allowedPaths");
    expect(err.message).toBe("file not allowed");
    expect(err.rule).toBe("allowedPaths");
    expect(err.name).toBe("PolicyViolationError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("sets statusCode 409 and name", () => {
    const err = new PolicyError("policy violated");
    expect(err.message).toBe("policy violated");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("sets statusCode 400 and name", () => {
    const err = new ValidationError("bad input");
    expect(err.message).toBe("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("formats the message and exposes agent/timeoutMs", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("sets message and name with rawOutput omitted", () => {
    const err = new OutputParseError("could not parse");
    expect(err.message).toBe("could not parse");
    expect(err.rawOutput).toBeUndefined();
    expect(err.name).toBe("OutputParseError");
  });

  it("preserves rawOutput when provided", () => {
    const err = new OutputParseError("could not parse", "garbage output");
    expect(err.rawOutput).toBe("garbage output");
  });
});

describe("StateTransitionError", () => {
  it("formats the message from fromState and event", () => {
    const err = new StateTransitionError("planning", "approve");
    expect(err.message).toBe('No transition from state "planning" for event "approve"');
    expect(err.fromState).toBe("planning");
    expect(err.event).toBe("approve");
    expect(err.name).toBe("StateTransitionError");
  });
});

describe("PreflightError", () => {
  function makeResult(overrides?: Partial<PreflightSummary>): PreflightSummary {
    return {
      ok: false,
      requiredRuntimes: ["claude", "codex"],
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: false, durationMs: 5, error: "unauthorized" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 8 },
          authCheck: { ok: true, durationMs: 3 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the failing runtimes in the message", () => {
    const result = makeResult();
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: claude");
    expect(err.name).toBe("PreflightError");
  });

  it("preserves the full result on the .result property", () => {
    const result = makeResult();
    const err = new PreflightError(result);
    expect(err.result).toBe(result);
  });

  it("lists multiple failing runtimes when several fail", () => {
    const result = makeResult({
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: false, error: "not found", durationMs: 1 },
          authCheck: { ok: false, durationMs: 1 },
        },
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: false, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: claude, cursor");
  });
});
