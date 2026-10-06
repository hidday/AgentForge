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
  it("sets message, name, and the rule that was violated", () => {
    const err = new PolicyViolationError("File not allowed", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("File not allowed");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("no-protected-paths");
  });
});

describe("PolicyError", () => {
  it("sets a 409 status code and the given message", () => {
    const err = new PolicyError("Policy blocked this action");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("Policy blocked this action");
  });
});

describe("ValidationError", () => {
  it("sets a 400 status code and the given message", () => {
    const err = new ValidationError("Invalid request body");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Invalid request body");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as properties", () => {
    const err = new AgentTimeoutError("executor", 120000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.message).toBe('Agent "executor" timed out after 120000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(120000);
  });
});

describe("OutputParseError", () => {
  it("sets the message and leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("Could not parse structured output");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("Could not parse structured output");
    expect(err.rawOutput).toBeUndefined();
  });

  it("captures the raw output when provided", () => {
    const err = new OutputParseError("Bad JSON", "not valid { json");
    expect(err.rawOutput).toBe("not valid { json");
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both as properties", () => {
    const err = new StateTransitionError("Planning", "APPROVE_PLAN");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StateTransitionError");
    expect(err.message).toBe('No transition from state "Planning" for event "APPROVE_PLAN"');
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("APPROVE_PLAN");
  });
});

describe("PreflightError", () => {
  function makeResult(overrides: Partial<PreflightSummary> = {}): PreflightSummary {
    return {
      ok: false,
      requiredRuntimes: ["claude", "codex"],
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: false, durationMs: 5, error: "not logged in" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 3 },
          authCheck: { ok: true, durationMs: 2 },
        },
      ],
      ...overrides,
    };
  }

  it("lists every runtime with a failing binary or auth check in the message", () => {
    const result = makeResult();
    const err = new PreflightError(result);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
    expect(err.result).toBe(result);
  });

  it("omits a runtime whose binary and auth checks both pass", () => {
    const result = makeResult({
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "missing", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("produces an empty failure list in the message when every runtime passes", () => {
    const result = makeResult({
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
