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
    const err = new PolicyViolationError("bad diff", "max-files");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("bad diff");
    expect(err.rule).toBe("max-files");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("sets a 409 status code, message, and name", () => {
    const err = new PolicyError("policy violated");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("policy violated");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("sets a 400 status code, message, and name", () => {
    const err = new ValidationError("bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as fields", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("stores the raw output when provided", () => {
    const err = new OutputParseError("could not parse JSON", "{not json");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("{not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
    expect(err.name).toBe("OutputParseError");
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both as fields", () => {
    const err = new StateTransitionError("Planning", "APPROVE");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "Planning" for event "APPROVE"');
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("APPROVE");
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
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the runtimes that failed either the binary or auth check", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(summary);
  });

  it("includes a runtime that fails only the auth check", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: true, durationMs: 3 },
          authCheck: { ok: false, error: "unauthorized", durationMs: 4 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });

  it("lists every failed runtime, comma-separated, when multiple fail", () => {
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
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: false, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
  });

  it("produces an empty failures list when every check passed", () => {
    const summary = makeSummary({
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
