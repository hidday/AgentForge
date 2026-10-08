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
  it("carries the message and rule, with the right name", () => {
    const err = new PolicyViolationError("Cannot do X", "x_not_allowed");
    expect(err.message).toBe("Cannot do X");
    expect(err.rule).toBe("x_not_allowed");
    expect(err.name).toBe("PolicyViolationError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("exposes a 409 status code", () => {
    const err = new PolicyError("policy violated");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
    expect(err.message).toBe("policy violated");
  });
});

describe("ValidationError", () => {
  it("exposes a 400 status code", () => {
    const err = new ValidationError("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("retains the raw output when provided", () => {
    const err = new OutputParseError("bad json", "{not json");
    expect(err.message).toBe("bad json");
    expect(err.rawOutput).toBe("{not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("allows an undefined raw output", () => {
    const err = new OutputParseError("bad json");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event", () => {
    const err = new StateTransitionError("Todo", "EXECUTE");
    expect(err.message).toBe('No transition from state "Todo" for event "EXECUTE"');
    expect(err.fromState).toBe("Todo");
    expect(err.event).toBe("EXECUTE");
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
          binaryCheck: { ok: false, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the failing runtimes (binary check failed) in the message", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code");
    expect(err.result).toBe(summary);
    expect(err.name).toBe("PreflightError");
  });

  it("includes a runtime whose auth check failed even if its binary check passed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: false, durationMs: 1, error: "no token" },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("lists multiple failing runtimes comma-separated", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: false, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
  });
});
