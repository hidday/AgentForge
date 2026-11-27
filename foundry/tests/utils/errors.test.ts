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
  it("sets message, name and the rule field", () => {
    const err = new PolicyViolationError("Touched a protected path", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Touched a protected path");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("no-protected-paths");
  });
});

describe("PolicyError", () => {
  it("sets message, name and a 409 status code", () => {
    const err = new PolicyError("Plan rejected by policy");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Plan rejected by policy");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name and a 400 status code", () => {
    const err = new ValidationError("Missing field");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Missing field");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message including the agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("planner", 120000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "planner" timed out after 120000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(120000);
  });
});

describe("OutputParseError", () => {
  it("sets message, name, and the optional rawOutput field when provided", () => {
    const err = new OutputParseError("Failed to parse JSON", "not json");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Failed to parse JSON");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("not json");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("Failed to parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message including the from-state and event, and exposes both fields", () => {
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

  it("builds a message listing only the runtimes that failed binary or auth checks", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
    expect(err.result).toBe(summary);
  });

  it("excludes runtimes whose binary and auth checks both pass", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "missing", durationMs: 2 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("produces an empty failures list in the message when all checks pass", () => {
    const summary = makeSummary({
      ok: true,
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
