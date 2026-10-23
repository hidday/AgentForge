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
  it("sets message, name, and the rule property", () => {
    const err = new PolicyViolationError("Touched a protected path", "no-protected-paths");
    expect(err.message).toBe("Touched a protected path");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("no-protected-paths");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 statusCode", () => {
    const err = new PolicyError("Conflicting policy state");
    expect(err.message).toBe("Conflicting policy state");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 statusCode", () => {
    const err = new ValidationError("Bad input");
    expect(err.message).toBe("Bad input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as properties", () => {
    const err = new AgentTimeoutError("executor", 120_000);
    expect(err.message).toBe('Agent "executor" timed out after 120000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(120_000);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("OutputParseError", () => {
  it("exposes rawOutput when provided", () => {
    const err = new OutputParseError("Could not parse output", "raw garbage text");
    expect(err.message).toBe("Could not parse output");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("raw garbage text");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("Could not parse output");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the fromState and event, and exposes both as properties", () => {
    const err = new StateTransitionError("Planning", "approve");
    expect(err.message).toBe('No transition from state "Planning" for event "approve"');
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("approve");
  });
});

describe("PreflightError", () => {
  function makeSummary(overrides: Partial<PreflightSummary> = {}): PreflightSummary {
    return {
      ok: false,
      requiredRuntimes: ["claude", "codex"],
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 5 },
          authCheck: { ok: false, durationMs: 10, error: "not authenticated" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 5 },
          authCheck: { ok: true, durationMs: 10 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the runtimes that failed binaryCheck or authCheck in the message", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(summary);
  });

  it("lists multiple failing runtimes, comma-separated", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: false, durationMs: 1, error: "not found" },
          authCheck: { ok: false, durationMs: 1, error: "n/a" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: false, durationMs: 1, error: "not authenticated" },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
  });

  it("produces an empty failure list in the message when every runtime passed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
