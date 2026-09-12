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
  it("carries the message and the offending rule name", () => {
    const err = new PolicyViolationError("Too many files changed", "max_files_changed");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyViolationError");
    expect(err.message).toBe("Too many files changed");
    expect(err.rule).toBe("max_files_changed");
  });
});

describe("PolicyError", () => {
  it("has a fixed 409 status code and the given message", () => {
    const err = new PolicyError("Cannot execute in this state");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("Cannot execute in this state");
  });
});

describe("ValidationError", () => {
  it("has a fixed 400 status code and the given message", () => {
    const err = new ValidationError("Missing required field");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Missing required field");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message including the agent name and timeout duration", () => {
    const err = new AgentTimeoutError("planner", 120_000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(120_000);
    expect(err.message).toBe('Agent "planner" timed out after 120000ms');
  });
});

describe("OutputParseError", () => {
  it("stores the raw output when provided", () => {
    const err = new OutputParseError("Invalid JSON", "not json{{{");
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("Invalid JSON");
    expect(err.rawOutput).toBe("not json{{{");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("Invalid JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a descriptive message from the from-state and event", () => {
    const err = new StateTransitionError("Planning", "PLAN_APPROVED");
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("PLAN_APPROVED");
    expect(err.message).toBe('No transition from state "Planning" for event "PLAN_APPROVED"');
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
          command: "claude --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: false, error: "not logged in", durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 3 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the runtimes that failed binary or auth checks in the message", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
    expect(err.result).toBe(summary);
  });

  it("omits runtimes whose binary and auth checks both passed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 3 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("produces an empty failure list when all checks pass (defensive construction)", () => {
    const summary = makeSummary({
      ok: true,
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
