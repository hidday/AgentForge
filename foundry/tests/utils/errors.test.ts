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
  it("carries the message and rule code", () => {
    const err = new PolicyViolationError("Cannot do X", "rule_x");
    expect(err.message).toBe("Cannot do X");
    expect(err.rule).toBe("rule_x");
    expect(err.name).toBe("PolicyViolationError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("sets a 409 status code", () => {
    const err = new PolicyError("policy denied");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
    expect(err.message).toBe("policy denied");
  });
});

describe("ValidationError", () => {
  it("sets a 400 status code", () => {
    const err = new ValidationError("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("stores the raw output when provided", () => {
    const err = new OutputParseError("could not parse", "garbage output");
    expect(err.message).toBe("could not parse");
    expect(err.rawOutput).toBe("garbage output");
    expect(err.name).toBe("OutputParseError");
  });

  it("allows rawOutput to be omitted", () => {
    const err = new OutputParseError("could not parse");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message describing the invalid transition", () => {
    const err = new StateTransitionError("Todo", "APPROVE_PLAN");
    expect(err.message).toBe('No transition from state "Todo" for event "APPROVE_PLAN"');
    expect(err.fromState).toBe("Todo");
    expect(err.event).toBe("APPROVE_PLAN");
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
          binaryCheck: { ok: true, version: "1.0", durationMs: 10 },
          authCheck: { ok: false, durationMs: 5, error: "not logged in" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, version: "1.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the runtimes that failed either check", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code");
    expect(err.result).toBe(summary);
    expect(err.name).toBe("PreflightError");
  });

  it("lists multiple failing runtimes when both checks fail", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: false, error: "not found", durationMs: 1 },
          authCheck: { ok: false, durationMs: 1, error: "not logged in" },
        },
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: false, error: "not found", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, cursor");
  });

  it("produces an empty failure list when every runtime passed both checks", () => {
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
