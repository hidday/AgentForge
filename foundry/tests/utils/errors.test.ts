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
  it("sets message, name and the rule field", () => {
    const err = new PolicyViolationError("file not allowed", "allowedPaths");
    expect(err.message).toBe("file not allowed");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("allowedPaths");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("sets message, name and a 409 status code", () => {
    const err = new PolicyError("policy conflict");
    expect(err.message).toBe("policy conflict");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name and a 400 status code", () => {
    const err = new ValidationError("bad input");
    expect(err.message).toBe("bad input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("OutputParseError", () => {
  it("stores the raw output when provided", () => {
    const err = new OutputParseError("could not parse JSON", "not json");
    expect(err.message).toBe("could not parse JSON");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("not json");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both fields", () => {
    const err = new StateTransitionError("Planning", "approve");
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
      requiredRuntimes: ["claude", "codex"],
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: false, durationMs: 10, error: "not found" },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: false, durationMs: 5, error: "unauthenticated" },
        },
      ],
      ...overrides,
    };
  }

  it("builds a message naming only the runtimes that failed either check", () => {
    const result = makeResult();
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(result);
  });

  it("excludes runtimes whose binary and auth checks both pass", () => {
    const result = makeResult({
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
          binaryCheck: { ok: false, durationMs: 10, error: "missing" },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("produces an empty runtime list in the message when every check passes", () => {
    const result = makeResult({
      ok: true,
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
