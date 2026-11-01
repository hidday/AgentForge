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
  it("PolicyViolationError carries the message and rule", () => {
    const err = new PolicyViolationError("bad diff", "max-files");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyViolationError");
    expect(err.message).toBe("bad diff");
    expect(err.rule).toBe("max-files");
  });

  it("PolicyError exposes a 409 status code", () => {
    const err = new PolicyError("policy failed");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("policy failed");
  });

  it("ValidationError exposes a 400 status code", () => {
    const err = new ValidationError("invalid input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });

  it("AgentTimeoutError formats the agent name and timeout into the message", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
  });

  it("OutputParseError stores the raw output when provided", () => {
    const err = new OutputParseError("could not parse", "raw text");
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("could not parse");
    expect(err.rawOutput).toBe("raw text");
  });

  it("OutputParseError allows omitting the raw output", () => {
    const err = new OutputParseError("could not parse");
    expect(err.rawOutput).toBeUndefined();
  });

  it("StateTransitionError formats the state and event into the message", () => {
    const err = new StateTransitionError("PLANNING", "APPROVE");
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("PLANNING");
    expect(err.event).toBe("APPROVE");
    expect(err.message).toBe('No transition from state "PLANNING" for event "APPROVE"');
  });

  it("PreflightError lists only the failing runtimes in its message and retains the full result", () => {
    const result: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude-code", "codex"],
      results: [
        {
          runtime: "claude-code",
          command: "claude --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "not found", durationMs: 3 },
          authCheck: { ok: false, error: "no token", durationMs: 1 },
        },
      ],
    };

    const err = new PreflightError(result);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: codex");
    expect(err.result).toBe(result);
  });

  it("PreflightError reports a failing runtime when only the auth check failed", () => {
    const result: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["cursor"],
      results: [
        {
          runtime: "cursor",
          command: "agent --version",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 2 },
          authCheck: { ok: false, error: "unauthorized", durationMs: 4 },
        },
      ],
    };

    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });
});
