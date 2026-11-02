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
  it("carries the message and rule", () => {
    const err = new PolicyViolationError("bad state", "some_rule");
    expect(err.message).toBe("bad state");
    expect(err.rule).toBe("some_rule");
    expect(err.name).toBe("PolicyViolationError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("sets a 409 status code", () => {
    const err = new PolicyError("conflict");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
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
  it("formats the message with agent name and timeout", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("carries the optional raw output", () => {
    const err = new OutputParseError("bad json", "{broken");
    expect(err.rawOutput).toBe("{broken");
    expect(err.name).toBe("OutputParseError");
  });

  it("allows omitting the raw output", () => {
    const err = new OutputParseError("bad json");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("formats the message with from-state and event", () => {
    const err = new StateTransitionError("Todo", "PLAN_CREATED");
    expect(err.message).toBe('No transition from state "Todo" for event "PLAN_CREATED"');
    expect(err.fromState).toBe("Todo");
    expect(err.event).toBe("PLAN_CREATED");
    expect(err.name).toBe("StateTransitionError");
  });
});

describe("PreflightError", () => {
  it("lists only the runtimes that failed either check", () => {
    const result: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude-code", "codex"],
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0", durationMs: 5 },
          authCheck: { ok: false, durationMs: 5, error: "not logged in" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, version: "1.0", durationMs: 5 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    };

    const err = new PreflightError(result);

    expect(err.message).toBe("Preflight failed for runtimes: claude-code");
    expect(err.result).toBe(result);
    expect(err.name).toBe("PreflightError");
  });
});
