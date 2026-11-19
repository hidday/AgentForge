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
  it("PolicyViolationError carries message and rule, with name set", () => {
    const err = new PolicyViolationError("bad thing happened", "no-secrets");
    expect(err.message).toBe("bad thing happened");
    expect(err.rule).toBe("no-secrets");
    expect(err.name).toBe("PolicyViolationError");
    expect(err).toBeInstanceOf(Error);
  });

  it("PolicyError has a 409 status code and the right name", () => {
    const err = new PolicyError("policy violated");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });

  it("ValidationError has a 400 status code and the right name", () => {
    const err = new ValidationError("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });

  it("AgentTimeoutError builds a message from agent name and timeout", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.name).toBe("AgentTimeoutError");
  });

  it("OutputParseError retains the raw output when provided", () => {
    const err = new OutputParseError("could not parse", "not json");
    expect(err.message).toBe("could not parse");
    expect(err.rawOutput).toBe("not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("OutputParseError works without rawOutput", () => {
    const err = new OutputParseError("could not parse");
    expect(err.rawOutput).toBeUndefined();
  });

  it("StateTransitionError builds a message from fromState and event", () => {
    const err = new StateTransitionError("Planning", "APPROVE");
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("APPROVE");
    expect(err.message).toBe('No transition from state "Planning" for event "APPROVE"');
    expect(err.name).toBe("StateTransitionError");
  });

  it("PreflightError summarizes only the runtimes that failed binary or auth checks", () => {
    const summary: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude", "codex", "cursor"],
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 1 },
        },
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: true, durationMs: 3 },
          authCheck: { ok: false, error: "unauthorized", durationMs: 4 },
        },
      ],
    };

    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: codex, cursor");
    expect(err.result).toBe(summary);
    expect(err.name).toBe("PreflightError");
  });

  it("PreflightError reports no failing runtimes when every check passed", () => {
    const summary: PreflightSummary = {
      ok: true,
      requiredRuntimes: ["claude"],
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    };
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
