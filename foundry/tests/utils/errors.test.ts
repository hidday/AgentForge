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
  it("sets message, name, and the rule property", () => {
    const err = new PolicyViolationError("file not allowed", "allowedPaths");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyViolationError");
    expect(err.message).toBe("file not allowed");
    expect(err.rule).toBe("allowedPaths");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 statusCode", () => {
    const err = new PolicyError("policy violation");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyError");
    expect(err.message).toBe("policy violation");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 statusCode", () => {
    const err = new ValidationError("bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ValidationError");
    expect(err.message).toBe("bad input");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as properties", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
  });
});

describe("OutputParseError", () => {
  it("sets message, name, and rawOutput when provided", () => {
    const err = new OutputParseError("could not parse", "not json");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("could not parse");
    expect(err.rawOutput).toBe("not json");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("could not parse");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the fromState and event, and exposes both as properties", () => {
    const err = new StateTransitionError("Planning", "APPROVE");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StateTransitionError");
    expect(err.message).toBe('No transition from state "Planning" for event "APPROVE"');
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("APPROVE");
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
          authCheck: { ok: false, error: "not logged in", durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 8 },
          authCheck: { ok: true, durationMs: 3 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the runtimes that failed binary or auth checks in the message", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code");
    expect(err.result).toBe(summary);
  });

  it("includes a runtime that failed its binary check even if auth passed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: false, error: "not found", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });

  it("lists multiple failing runtimes joined by comma", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: false, durationMs: 1 },
          authCheck: { ok: false, durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
  });

  it("produces an empty failures list in the message when all checks pass", () => {
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
