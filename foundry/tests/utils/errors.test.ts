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
  it("sets message, name, and the rule that was violated", () => {
    const err = new PolicyViolationError("Touched a protected path", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyViolationError");
    expect(err.message).toBe("Touched a protected path");
    expect(err.rule).toBe("no-protected-paths");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 status code", () => {
    const err = new PolicyError("Plan not approved");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyError");
    expect(err.message).toBe("Plan not approved");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 status code", () => {
    const err = new ValidationError("Missing required field");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ValidationError");
    expect(err.message).toBe("Missing required field");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message including the agent name and timeout, and exposes both as properties", () => {
    const err = new AgentTimeoutError("executor", 60_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.message).toBe('Agent "executor" timed out after 60000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(60_000);
  });
});

describe("OutputParseError", () => {
  it("sets message, name, and the raw output when provided", () => {
    const err = new OutputParseError("Could not parse JSON", "not json at all");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("Could not parse JSON");
    expect(err.rawOutput).toBe("not json at all");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("Could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message describing the invalid transition and exposes fromState/event", () => {
    const err = new StateTransitionError("PlanApproved", "reject_plan");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StateTransitionError");
    expect(err.message).toBe('No transition from state "PlanApproved" for event "reject_plan"');
    expect(err.fromState).toBe("PlanApproved");
    expect(err.event).toBe("reject_plan");
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
          authCheck: { ok: false, durationMs: 5, error: "not authenticated" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
      ...overrides,
    };
  }

  it("builds a message listing only the failing runtimes and retains the full result", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(summary);
  });

  it("lists no runtimes in the message when every check passes", () => {
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
