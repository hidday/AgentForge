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
  it("sets message, name, and the violated rule", () => {
    const err = new PolicyViolationError("too many files changed", "maxFilesChanged");
    expect(err.message).toBe("too many files changed");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("maxFilesChanged");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 status code", () => {
    const err = new PolicyError("run is not in a state that allows this action");
    expect(err.message).toBe("run is not in a state that allows this action");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 status code", () => {
    const err = new ValidationError("missing required field");
    expect(err.message).toBe("missing required field");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a descriptive message from the agent name and timeout", () => {
    const err = new AgentTimeoutError("planner", 60000);
    expect(err.message).toBe('Agent "planner" timed out after 60000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(60000);
  });
});

describe("OutputParseError", () => {
  it("carries the raw output when provided", () => {
    const err = new OutputParseError("could not find structured output markers", "garbage output");
    expect(err.message).toBe("could not find structured output markers");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("garbage output");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("bad json");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a descriptive message from the from-state and event", () => {
    const err = new StateTransitionError("Completed", "approve-plan");
    expect(err.message).toBe('No transition from state "Completed" for event "approve-plan"');
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("Completed");
    expect(err.event).toBe("approve-plan");
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
          binaryCheck: { ok: true, version: "v1", durationMs: 5 },
          authCheck: { ok: false, error: "not logged in", durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, version: "v2", durationMs: 5 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the runtimes that failed either check in the message", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(summary);
  });

  it("lists multiple failing runtimes when both binary and auth checks fail", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: false, error: "not found", durationMs: 5 },
          authCheck: { ok: false, error: "skipped", durationMs: 0 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, version: "v2", durationMs: 5 },
          authCheck: { ok: false, error: "not logged in", durationMs: 5 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
  });

  it("lists no runtimes when every check passed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, version: "v1", durationMs: 5 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
