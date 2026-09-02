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
  it("carries the message and rule, and sets a distinct error name", () => {
    const err = new PolicyViolationError("Cannot plan now", "plan_requires_todo_state");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Cannot plan now");
    expect(err.rule).toBe("plan_requires_todo_state");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("defaults to HTTP 409", () => {
    const err = new PolicyError("Invalid state for this operation");

    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
    expect(err.message).toBe("Invalid state for this operation");
  });
});

describe("ValidationError", () => {
  it("defaults to HTTP 400", () => {
    const err = new ValidationError("Missing required field");

    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as fields", () => {
    const err = new AgentTimeoutError("executor", 600_000);

    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(600_000);
    expect(err.message).toBe('Agent "executor" timed out after 600000ms');
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("preserves the raw output that failed to parse", () => {
    const err = new OutputParseError("Unexpected token", "{not valid json");

    expect(err.message).toBe("Unexpected token");
    expect(err.rawOutput).toBe("{not valid json");
    expect(err.name).toBe("OutputParseError");
  });

  it("allows omitting the raw output", () => {
    const err = new OutputParseError("No output produced");

    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a descriptive message from the from-state and event", () => {
    const err = new StateTransitionError("Done", "PLAN_APPROVED");

    expect(err.fromState).toBe("Done");
    expect(err.event).toBe("PLAN_APPROVED");
    expect(err.message).toBe('No transition from state "Done" for event "PLAN_APPROVED"');
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
          authCheck: { ok: false, durationMs: 5, error: "not logged in" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
      ...overrides,
    };
  }

  it("names only the runtimes that failed a binary or auth check", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(summary);
    expect(err.name).toBe("PreflightError");
  });

  it("omits fully-healthy runtimes from the message", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });
});
