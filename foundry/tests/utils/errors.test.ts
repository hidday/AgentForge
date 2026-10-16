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
  it("carries the message and rule, and sets the error name", () => {
    const err = new PolicyViolationError("touched a protected path", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("touched a protected path");
    expect(err.rule).toBe("no-protected-paths");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 status code", () => {
    const err = new PolicyError("conflicting policy state");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("conflicting policy state");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 status code", () => {
    const err = new ValidationError("bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("bad input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("carries the message and optional raw output", () => {
    const err = new OutputParseError("could not parse JSON", "not json");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("allows rawOutput to be omitted", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both fields", () => {
    const err = new StateTransitionError("planning", "approve");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "planning" for event "approve"');
    expect(err.fromState).toBe("planning");
    expect(err.event).toBe("approve");
    expect(err.name).toBe("StateTransitionError");
  });
});

describe("PreflightError", () => {
  function makeResult(overrides: Partial<PreflightSummary> = {}): PreflightSummary {
    return {
      ok: false,
      requiredRuntimes: ["claude", "codex"],
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
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the runtimes that failed binaryCheck or authCheck in the message", () => {
    const result = makeResult();
    const err = new PreflightError(result);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(result);
  });

  it("includes a runtime that fails only the authCheck", () => {
    const result = makeResult({
      results: [
        {
          runtime: "cursor",
          command: "agent --version",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 1 },
          authCheck: { ok: false, error: "not logged in", durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });

  it("joins multiple failing runtimes with a comma", () => {
    const result = makeResult({
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: false, durationMs: 1 },
          authCheck: { ok: false, durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
  });

  it("produces an empty runtime list in the message when nothing actually failed", () => {
    const result = makeResult({
      ok: true,
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
