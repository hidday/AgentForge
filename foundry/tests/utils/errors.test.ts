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
  it("carries the message, rule, and correct name", () => {
    const err = new PolicyViolationError("File not allowed", "allowedPaths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("File not allowed");
    expect(err.rule).toBe("allowedPaths");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("carries the message, a 409 status code, and correct name", () => {
    const err = new PolicyError("Policy conflict");
    expect(err.message).toBe("Policy conflict");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("carries the message, a 400 status code, and correct name", () => {
    const err = new ValidationError("Bad input");
    expect(err.message).toBe("Bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("OutputParseError", () => {
  it("carries the message and optional rawOutput", () => {
    const err = new OutputParseError("Could not parse JSON", "not json");
    expect(err.message).toBe("Could not parse JSON");
    expect(err.rawOutput).toBe("not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("allows rawOutput to be omitted", () => {
    const err = new OutputParseError("Could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from fromState and event, and exposes both fields", () => {
    const err = new StateTransitionError("Planning", "APPROVE");
    expect(err.message).toBe('No transition from state "Planning" for event "APPROVE"');
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("APPROVE");
    expect(err.name).toBe("StateTransitionError");
  });
});

describe("PreflightError", () => {
  function makeSummary(overrides: Partial<PreflightSummary> = {}): PreflightSummary {
    return {
      ok: false,
      requiredRuntimes: ["claude", "codex"],
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: false, error: "not logged in", durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 3 },
          authCheck: { ok: true, durationMs: 2 },
        },
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: true, durationMs: 4 },
          authCheck: { ok: true, durationMs: 2 },
        },
      ],
      ...overrides,
    };
  }

  it("builds a message listing only the runtimes that failed binary or auth checks", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(summary);
  });

  it("produces an empty failure list when every runtime passes both checks", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude",
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
