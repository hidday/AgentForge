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
  it("carries a message and rule, and is an Error with the right name", () => {
    const err = new PolicyViolationError("Cannot do X", "no_x_rule");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Cannot do X");
    expect(err.rule).toBe("no_x_rule");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("has a 409 status code and the right name", () => {
    const err = new PolicyError("Conflict");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Conflict");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("has a 400 status code and the right name", () => {
    const err = new ValidationError("Bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("carries a message and optional raw output", () => {
    const err = new OutputParseError("Could not parse JSON", "not json");
    expect(err.message).toBe("Could not parse JSON");
    expect(err.rawOutput).toBe("not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("allows rawOutput to be omitted", () => {
    const err = new OutputParseError("Could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both fields", () => {
    const err = new StateTransitionError("Todo", "APPROVE_PLAN");
    expect(err.message).toBe('No transition from state "Todo" for event "APPROVE_PLAN"');
    expect(err.fromState).toBe("Todo");
    expect(err.event).toBe("APPROVE_PLAN");
    expect(err.name).toBe("StateTransitionError");
  });
});

describe("PreflightError", () => {
  function makeSummary(overrides: Partial<PreflightSummary> = {}): PreflightSummary {
    return {
      ok: false,
      requiredRuntimes: ["claude-code", "codex"],
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: false, error: "not logged in", durationMs: 5 },
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

  it("builds a message listing only the runtimes that failed either check", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(summary);
  });

  it("lists a runtime whose binary check failed even if auth also failed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "cursor",
          command: "cursor",
          binaryCheck: { ok: false, error: "not found", durationMs: 1 },
          authCheck: { ok: false, error: "skipped", durationMs: 0 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });

  it("lists multiple failing runtimes joined by comma", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: false, error: "err", durationMs: 1 },
          authCheck: { ok: false, error: "err", durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "err", durationMs: 1 },
          authCheck: { ok: false, error: "err", durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
  });
});
