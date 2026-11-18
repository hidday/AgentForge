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
  it("sets message, name and the rule that was violated", () => {
    const err = new PolicyViolationError("File not allowed", "allowedPaths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("File not allowed");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("allowedPaths");
  });
});

describe("PolicyError", () => {
  it("sets message, name and a 409 status code", () => {
    const err = new PolicyError("Conflicting policy state");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Conflicting policy state");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name and a 400 status code", () => {
    const err = new ValidationError("Bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Bad input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("executor", 120_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 120000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(120_000);
  });
});

describe("OutputParseError", () => {
  it("stores the raw output when provided", () => {
    const err = new OutputParseError("Could not parse JSON", "not json");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Could not parse JSON");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("not json");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("Could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both fields", () => {
    const err = new StateTransitionError("PLANNING", "APPROVE_EXECUTION");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(
      'No transition from state "PLANNING" for event "APPROVE_EXECUTION"',
    );
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("PLANNING");
    expect(err.event).toBe("APPROVE_EXECUTION");
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
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 3 },
          authCheck: { ok: false, error: "no auth", durationMs: 2 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the failing runtimes in the message and stores the full result", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: codex");
    expect(err.result).toBe(summary);
  });

  it("includes a runtime whose binaryCheck passed but authCheck failed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 3 },
          authCheck: { ok: false, error: "no auth", durationMs: 2 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("produces an empty failure list in the message when all runtimes pass", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
