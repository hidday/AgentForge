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

describe("utils/errors", () => {
  it("PolicyViolationError sets message, rule, and name; is an Error instance", () => {
    const err = new PolicyViolationError("forbidden path touched", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("forbidden path touched");
    expect(err.rule).toBe("no-protected-paths");
    expect(err.name).toBe("PolicyViolationError");
  });

  it("PolicyError sets statusCode 409 and name", () => {
    const err = new PolicyError("policy violated");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("policy violated");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });

  it("ValidationError sets statusCode 400 and name", () => {
    const err = new ValidationError("bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });

  it("AgentTimeoutError builds a message from agent name and timeoutMs, and exposes both fields", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });

  it("OutputParseError stores an optional rawOutput and defaults it to undefined", () => {
    const withRaw = new OutputParseError("could not parse JSON", "{not json");
    expect(withRaw.message).toBe("could not parse JSON");
    expect(withRaw.rawOutput).toBe("{not json");
    expect(withRaw.name).toBe("OutputParseError");

    const withoutRaw = new OutputParseError("could not parse JSON");
    expect(withoutRaw.rawOutput).toBeUndefined();
  });

  it("StateTransitionError builds a message from fromState and event, and exposes both fields", () => {
    const err = new StateTransitionError("Planning", "approve");
    expect(err.message).toBe('No transition from state "Planning" for event "approve"');
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("approve");
    expect(err.name).toBe("StateTransitionError");
  });

  it("PreflightError lists only the failing runtimes in its message and stores the full result", () => {
    const result: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude-code", "codex", "cursor"],
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
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 8 },
          authCheck: { ok: false, error: "not logged in", durationMs: 3 },
        },
      ],
    };

    const err = new PreflightError(result);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: codex, cursor");
    expect(err.result).toBe(result);
  });

  it("PreflightError produces an empty failure list in its message when every runtime passes", () => {
    const result: PreflightSummary = {
      ok: true,
      requiredRuntimes: ["claude-code"],
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    };

    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: ");
    expect(err.result.ok).toBe(true);
  });
});
