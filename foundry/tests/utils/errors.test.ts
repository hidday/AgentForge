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
  it("PolicyViolationError carries message and rule", () => {
    const err = new PolicyViolationError("file touched a protected path", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyViolationError");
    expect(err.message).toBe("file touched a protected path");
    expect(err.rule).toBe("no-protected-paths");
  });

  it("PolicyError has a fixed statusCode of 409", () => {
    const err = new PolicyError("conflicting state transition");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("conflicting state transition");
  });

  it("ValidationError has a fixed statusCode of 400", () => {
    const err = new ValidationError("missing required field");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("missing required field");
  });

  it("AgentTimeoutError builds a message from agent and timeoutMs and exposes both", () => {
    const err = new AgentTimeoutError("planner", 120_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(120_000);
    expect(err.message).toBe('Agent "planner" timed out after 120000ms');
  });

  it("OutputParseError stores rawOutput when provided", () => {
    const err = new OutputParseError("could not find structured output markers", "raw cli text");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("could not find structured output markers");
    expect(err.rawOutput).toBe("raw cli text");
  });

  it("OutputParseError allows rawOutput to be omitted", () => {
    const err = new OutputParseError("no markers found");
    expect(err.rawOutput).toBeUndefined();
  });

  it("StateTransitionError builds a message from fromState and event and exposes both", () => {
    const err = new StateTransitionError("PlanApproved", "reject");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("PlanApproved");
    expect(err.event).toBe("reject");
    expect(err.message).toBe('No transition from state "PlanApproved" for event "reject"');
  });

  it("PreflightError derives failed runtimes from binaryCheck and authCheck failures", () => {
    const summary: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude-code", "codex"],
      results: [
        {
          runtime: "claude-code",
          command: "claude --version",
          binaryCheck: { ok: false, error: "not found", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 8 },
          authCheck: { ok: false, error: "unauthenticated", durationMs: 3 },
        },
      ],
    };

    const err = new PreflightError(summary);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
  });

  it("PreflightError reports no failing runtimes when all checks pass", () => {
    const summary: PreflightSummary = {
      ok: true,
      requiredRuntimes: ["claude-code"],
      results: [
        {
          runtime: "claude-code",
          command: "claude --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    };

    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: ");
    expect(err.result.ok).toBe(true);
  });

  it("PreflightError only lists runtimes with a failing binary OR auth check, not both duplicated", () => {
    const summary: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude-code"],
      results: [
        {
          runtime: "claude-code",
          command: "claude --version",
          binaryCheck: { ok: false, error: "missing binary", durationMs: 1 },
          authCheck: { ok: false, error: "missing token", durationMs: 1 },
        },
      ],
    };

    const err = new PreflightError(summary);
    const occurrences = err.message.split("claude-code").length - 1;
    expect(occurrences).toBe(1);
  });
});
