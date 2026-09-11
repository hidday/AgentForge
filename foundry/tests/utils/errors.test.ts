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
  it("carries the message and rule, and sets its name", () => {
    const err = new PolicyViolationError("File not allowed", "allowedPaths");
    expect(err.message).toBe("File not allowed");
    expect(err.rule).toBe("allowedPaths");
    expect(err.name).toBe("PolicyViolationError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("sets statusCode 409 and its name", () => {
    const err = new PolicyError("Run is already terminal");
    expect(err.message).toBe("Run is already terminal");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("sets statusCode 400 and its name", () => {
    const err = new ValidationError("Missing required field");
    expect(err.message).toBe("Missing required field");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a descriptive message from agent name and timeoutMs, and exposes both as properties", () => {
    const err = new AgentTimeoutError("executor", 120000);
    expect(err.message).toBe('Agent "executor" timed out after 120000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(120000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("carries the message and optional rawOutput, and sets its name", () => {
    const err = new OutputParseError("Could not parse JSON", "{not json");
    expect(err.message).toBe("Could not parse JSON");
    expect(err.rawOutput).toBe("{not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("allows rawOutput to be omitted", () => {
    const err = new OutputParseError("Could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a descriptive message from fromState and event, and exposes both as properties", () => {
    const err = new StateTransitionError("Planning", "approve");
    expect(err.message).toBe('No transition from state "Planning" for event "approve"');
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("approve");
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
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 5 },
          authCheck: { ok: false, error: "not logged in", durationMs: 10 },
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

  it("builds a message listing only the runtimes that failed binary or auth checks", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(summary);
  });

  it("omits runtimes that passed both checks from the failure message", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "missing", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });
});
