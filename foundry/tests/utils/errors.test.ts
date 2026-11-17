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

describe("custom error classes", () => {
  it("PolicyViolationError carries the message and rule, and is an Error", () => {
    const err = new PolicyViolationError("file not allowed", "allowed-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyViolationError");
    expect(err.message).toBe("file not allowed");
    expect(err.rule).toBe("allowed-paths");
  });

  it("PolicyError sets statusCode 409", () => {
    const err = new PolicyError("cannot transition");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("cannot transition");
  });

  it("ValidationError sets statusCode 400", () => {
    const err = new ValidationError("bad input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("bad input");
  });

  it("AgentTimeoutError builds a message from agent name and timeout", () => {
    const err = new AgentTimeoutError("executor", 60_000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(60_000);
    expect(err.message).toBe('Agent "executor" timed out after 60000ms');
  });

  it("OutputParseError stores the raw output when provided", () => {
    const err = new OutputParseError("could not parse JSON", "not json");
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("not json");
  });

  it("OutputParseError leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });

  it("StateTransitionError builds a message from state and event", () => {
    const err = new StateTransitionError("Planning", "approve_plan");
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("approve_plan");
    expect(err.message).toBe('No transition from state "Planning" for event "approve_plan"');
  });

  it("PreflightError lists only failing runtimes in its message and retains the full result", () => {
    const result: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude", "codex", "cursor"],
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "not found", durationMs: 3 },
          authCheck: { ok: true, durationMs: 4 },
        },
        {
          runtime: "cursor",
          command: "agent --version",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 8 },
          authCheck: { ok: false, error: "unauthenticated", durationMs: 6 },
        },
      ],
    };

    const err = new PreflightError(result);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: codex, cursor");
    expect(err.result).toBe(result);
  });

  it("PreflightError reports no failing runtimes when all checks pass", () => {
    const result: PreflightSummary = {
      ok: true,
      requiredRuntimes: ["claude"],
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    };

    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
