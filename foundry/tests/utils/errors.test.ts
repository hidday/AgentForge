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

describe("error classes", () => {
  it("PolicyViolationError carries a message and rule code", () => {
    const err = new PolicyViolationError("cannot do that", "some_rule");
    expect(err.message).toBe("cannot do that");
    expect(err.rule).toBe("some_rule");
    expect(err.name).toBe("PolicyViolationError");
  });

  it("PolicyError exposes a 409 status code", () => {
    const err = new PolicyError("conflict");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });

  it("ValidationError exposes a 400 status code", () => {
    const err = new ValidationError("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });

  it("AgentTimeoutError formats a message from agent name and timeout", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });

  it("OutputParseError stores the raw output that failed to parse", () => {
    const err = new OutputParseError("could not parse", "garbage output");
    expect(err.message).toBe("could not parse");
    expect(err.rawOutput).toBe("garbage output");
    expect(err.name).toBe("OutputParseError");
  });

  it("OutputParseError works without a rawOutput argument", () => {
    const err = new OutputParseError("could not parse");
    expect(err.rawOutput).toBeUndefined();
  });

  it("StateTransitionError formats a message from state and event", () => {
    const err = new StateTransitionError("Todo", "approve_plan");
    expect(err.message).toBe('No transition from state "Todo" for event "approve_plan"');
    expect(err.fromState).toBe("Todo");
    expect(err.event).toBe("approve_plan");
    expect(err.name).toBe("StateTransitionError");
  });

  it("PreflightError lists only the failing runtimes in its message", () => {
    const summary: PreflightSummary = {
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
          authCheck: { ok: false, durationMs: 1 },
        },
      ],
    };

    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: codex");
    expect(err.result).toBe(summary);
    expect(err.name).toBe("PreflightError");
  });
});
