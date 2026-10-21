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
    const err = new PolicyViolationError("file not allowed", "allowedPaths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("file not allowed");
    expect(err.rule).toBe("allowedPaths");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("sets statusCode 409 and the error name", () => {
    const err = new PolicyError("conflicting policy");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
    expect(err.message).toBe("conflicting policy");
  });
});

describe("ValidationError", () => {
  it("sets statusCode 400 and the error name", () => {
    const err = new ValidationError("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
    expect(err.message).toBe("bad input");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as fields", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
  });
});

describe("OutputParseError", () => {
  it("stores the raw output when provided", () => {
    const err = new OutputParseError("could not parse JSON", "{not json");
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("{not json");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both as fields", () => {
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
      requiredRuntimes: ["claude-code", "codex"],
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: false, durationMs: 5, error: "not authenticated" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 12 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
      ...overrides,
    };
  }

  it("names only the runtimes that failed binary or auth checks, not the healthy ones", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code");
    expect(err.message).not.toContain("codex");
    expect(err.result).toBe(summary);
  });

  it("lists multiple failing runtimes when more than one check fails", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: false, error: "not found", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: false, error: "no token", durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
  });

  it("produces an empty runtime list in the message when every check passed", () => {
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
