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
  it("sets message, name, and the rule property", () => {
    const err = new PolicyViolationError("Touched a protected path", "protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Touched a protected path");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("protected-paths");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and statusCode 409", () => {
    const err = new PolicyError("Run is in an invalid state for this action");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Run is in an invalid state for this action");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and statusCode 400", () => {
    const err = new ValidationError("Missing required field");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Missing required field");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds the message from the agent name and timeout, and exposes both as properties", () => {
    const err = new AgentTimeoutError("executor", 120_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 120000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(120_000);
  });
});

describe("OutputParseError", () => {
  it("sets message, name, and rawOutput when provided", () => {
    const err = new OutputParseError("Could not parse JSON", '{"broken": true');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Could not parse JSON");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe('{"broken": true');
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("Could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds the message from fromState and event, and exposes both as properties", () => {
    const err = new StateTransitionError("Planning", "approve");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "Planning" for event "approve"');
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("approve");
  });
});

describe("PreflightError", () => {
  function makeResult(overrides: Partial<PreflightSummary> = {}): PreflightSummary {
    return {
      ok: false,
      requiredRuntimes: ["claude-code", "codex"],
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 5 },
          authCheck: { ok: false, durationMs: 3, error: "not logged in" },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 4 },
          authCheck: { ok: true, durationMs: 2 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the runtimes that failed binaryCheck or authCheck in the message", () => {
    const result = makeResult();
    const err = new PreflightError(result);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code");
    expect(err.result).toBe(result);
  });

  it("includes a runtime that fails on binaryCheck even if authCheck passed", () => {
    const result = makeResult({
      results: [
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: false, error: "not found", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });

  it("lists multiple failing runtimes joined by comma", () => {
    const result = makeResult({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: false, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: false, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
  });

  it("produces an empty failure list in the message when all checks pass (edge case)", () => {
    const result = makeResult({
      ok: true,
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
