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
  it("carries the message, rule, and name", () => {
    const err = new PolicyViolationError("File touches protected path", "no-protected-paths");
    expect(err.message).toBe("File touches protected path");
    expect(err.rule).toBe("no-protected-paths");
    expect(err.name).toBe("PolicyViolationError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("has statusCode 409 and the expected name", () => {
    const err = new PolicyError("Wrong state: Planning");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
    expect(err.message).toBe("Wrong state: Planning");
  });
});

describe("ValidationError", () => {
  it("has statusCode 400 and the expected name", () => {
    const err = new ValidationError("Missing required field");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a descriptive message from the agent name and timeout", () => {
    const err = new AgentTimeoutError("planner", 120_000);
    expect(err.message).toBe('Agent "planner" timed out after 120000ms');
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(120_000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("stores the raw output when provided", () => {
    const err = new OutputParseError("Could not parse JSON", "not json");
    expect(err.message).toBe("Could not parse JSON");
    expect(err.rawOutput).toBe("not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("Could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message describing the invalid transition", () => {
    const err = new StateTransitionError("Planning", "approve-plan");
    expect(err.message).toBe('No transition from state "Planning" for event "approve-plan"');
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("approve-plan");
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
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: false, durationMs: 5, error: "unauthorized" },
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

  it("lists only the runtimes that failed binary or auth checks", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(summary);
    expect(err.name).toBe("PreflightError");
  });

  it("produces an empty failure list when every runtime passes both checks", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
