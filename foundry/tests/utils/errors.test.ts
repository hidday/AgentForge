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
  it("carries the message and rule, and sets the error name", () => {
    const err = new PolicyViolationError("forbidden path touched", "no-touch-infra");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("forbidden path touched");
    expect(err.rule).toBe("no-touch-infra");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("sets a 409 status code, the message, and the error name", () => {
    const err = new PolicyError("policy check failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("policy check failed");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("sets a 400 status code, the message, and the error name", () => {
    const err = new ValidationError("invalid input");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("invalid input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as fields", () => {
    const err = new AgentTimeoutError("executor", 120_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 120000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(120_000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("carries the message and optional raw output", () => {
    const err = new OutputParseError("could not parse JSON", "{not json");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("{not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both as fields", () => {
    const err = new StateTransitionError("Planning", "approve");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "Planning" for event "approve"');
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("approve");
    expect(err.name).toBe("StateTransitionError");
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
          authCheck: { ok: false, durationMs: 5, error: "not logged in" },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
      ...overrides,
    };
  }

  it("builds a message listing only the runtimes with a failing binary or auth check", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(summary);
  });

  it("excludes runtimes whose binary and auth checks both pass", () => {
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
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("produces an empty runtime list in the message when all checks pass", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
