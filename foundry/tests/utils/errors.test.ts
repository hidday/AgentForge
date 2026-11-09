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
    const err = new PolicyViolationError("Touched a protected path", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Touched a protected path");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("no-protected-paths");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 status code", () => {
    const err = new PolicyError("Run is not in a state that allows this action");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Run is not in a state that allows this action");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 status code", () => {
    const err = new ValidationError("Missing required field");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Missing required field");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as fields", () => {
    const err = new AgentTimeoutError("planner", 120_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "planner" timed out after 120000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(120_000);
  });
});

describe("OutputParseError", () => {
  it("stores the message and optional raw output", () => {
    const err = new OutputParseError("Could not find structured output markers", "garbled cli output");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Could not find structured output markers");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("garbled cli output");
  });

  it("allows rawOutput to be omitted", () => {
    const err = new OutputParseError("Could not parse output");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message describing the invalid transition and exposes fromState/event", () => {
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
          authCheck: { ok: false, durationMs: 10, error: "not authenticated" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "binary not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 3 },
        },
      ],
      ...overrides,
    };
  }

  it("lists every runtime that failed its binary check or auth check in the message", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(summary);
  });

  it("omits runtimes whose binary and auth checks both passed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 5 },
          authCheck: { ok: true, durationMs: 10 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "binary not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 3 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("produces an empty failures list in the message when every check passed", () => {
    const summary = makeSummary({
      ok: true,
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 5 },
          authCheck: { ok: true, durationMs: 10 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
