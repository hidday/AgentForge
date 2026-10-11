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
    const err = new PolicyViolationError("protected path touched", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.message).toBe("protected path touched");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("no-protected-paths");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 status code", () => {
    const err = new PolicyError("policy failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("policy failed");
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
  it("builds a message from agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
  });
});

describe("OutputParseError", () => {
  it("stores the message and optional raw output", () => {
    const err = new OutputParseError("could not parse", "raw-snippet");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("could not parse");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("raw-snippet");
  });

  it("allows rawOutput to be omitted", () => {
    const err = new OutputParseError("could not parse");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a descriptive message from fromState and event, and exposes both", () => {
    const err = new StateTransitionError("planning", "approve");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "planning" for event "approve"');
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("planning");
    expect(err.event).toBe("approve");
  });
});

describe("PreflightError", () => {
  const baseResult: PreflightSummary = {
    ok: false,
    requiredRuntimes: ["claude-code", "codex"],
    results: [
      {
        runtime: "claude-code",
        command: "claude",
        binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
        authCheck: { ok: false, durationMs: 20, error: "not logged in" },
      },
      {
        runtime: "codex",
        command: "codex",
        binaryCheck: { ok: false, error: "not found", durationMs: 5 },
        authCheck: { ok: false, durationMs: 0, error: "Skipped: binary check failed" },
      },
    ],
  };

  it("builds a message listing only the failing runtimes and stores the full result", () => {
    const err = new PreflightError(baseResult);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(baseResult);
  });

  it("omits runtimes whose binary and auth checks both passed", () => {
    const result: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude-code", "cursor"],
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 20 },
        },
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: true, durationMs: 5 },
          authCheck: { ok: false, durationMs: 1, error: "not logged in" },
        },
      ],
    };
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });
});
