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
  it("sets message, rule and name, and is an instance of Error", () => {
    const err = new PolicyViolationError("touched a protected path", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("touched a protected path");
    expect(err.rule).toBe("no-protected-paths");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("sets a 409 status code and the given message", () => {
    const err = new PolicyError("conflicting run state");
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("conflicting run state");
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("sets a 400 status code and the given message", () => {
    const err = new ValidationError("bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("bad input");
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as fields", () => {
    const err = new AgentTimeoutError("planner", 120_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(120_000);
    expect(err.message).toBe('Agent "planner" timed out after 120000ms');
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("stores the raw output when provided", () => {
    const err = new OutputParseError("could not parse JSON", "{ broken json");
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("{ broken json");
    expect(err.name).toBe("OutputParseError");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from fromState and event, and exposes both as fields", () => {
    const err = new StateTransitionError("PLANNING", "APPROVE");
    expect(err).toBeInstanceOf(Error);
    expect(err.fromState).toBe("PLANNING");
    expect(err.event).toBe("APPROVE");
    expect(err.message).toBe('No transition from state "PLANNING" for event "APPROVE"');
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
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: false, error: "no auth", durationMs: 1 },
        },
      ],
      ...overrides,
    };
  }

  it("builds a message listing only the failing runtimes and stores the full result", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: codex");
    expect(err.result).toBe(summary);
  });

  it("includes a runtime once if either binaryCheck or authCheck failed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: false, error: "no auth", durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });

  it("produces an empty runtimes list in the message when all checks pass", () => {
    const summary = makeSummary({
      ok: true,
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
