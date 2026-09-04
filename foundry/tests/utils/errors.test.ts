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
    const err = new PolicyViolationError("File not allowed", "allowed-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("File not allowed");
    expect(err.rule).toBe("allowed-paths");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 status code", () => {
    const err = new PolicyError("Conflicting policy");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Conflicting policy");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 status code", () => {
    const err = new ValidationError("Bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Bad input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as properties", () => {
    const err = new AgentTimeoutError("executor", 120_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 120000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(120_000);
  });
});

describe("OutputParseError", () => {
  it("sets the message and name, with rawOutput undefined when omitted", () => {
    const err = new OutputParseError("Could not parse JSON");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Could not parse JSON");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBeUndefined();
  });

  it("stores rawOutput when provided", () => {
    const err = new OutputParseError("Could not parse JSON", "not json at all");
    expect(err.rawOutput).toBe("not json at all");
  });
});

describe("StateTransitionError", () => {
  it("builds a message from fromState and event, and exposes both as properties", () => {
    const err = new StateTransitionError("Planning", "approve");
    expect(err).toBeInstanceOf(Error);
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
      requiredRuntimes: ["claude-code", "codex"],
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 5 },
          authCheck: { ok: false, durationMs: 3, error: "not logged in" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 1 },
          authCheck: { ok: true, durationMs: 2 },
        },
      ],
      ...overrides,
    };
  }

  it("builds a message listing every runtime with a failing binary or auth check", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(summary);
  });

  it("lists only the runtimes that actually failed, not passing ones", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 5 },
          authCheck: { ok: true, durationMs: 3 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 1 },
          authCheck: { ok: true, durationMs: 2 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("produces an empty failure list in the message when all checks pass", () => {
    const summary = makeSummary({
      ok: true,
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 5 },
          authCheck: { ok: true, durationMs: 3 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
