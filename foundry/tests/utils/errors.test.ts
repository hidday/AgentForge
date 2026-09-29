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
    const err = new PolicyViolationError("touched a protected file", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("touched a protected file");
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
    const err = new ValidationError("invalid payload");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("invalid payload");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from agent and timeoutMs, and exposes both as properties", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
  });
});

describe("OutputParseError", () => {
  it("sets message, name, and an optional rawOutput", () => {
    const err = new OutputParseError("could not parse JSON", "{not json");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("could not parse JSON");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("{not json");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from fromState and event, and exposes both as properties", () => {
    const err = new StateTransitionError("PLANNING", "EXECUTE");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "PLANNING" for event "EXECUTE"');
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("PLANNING");
    expect(err.event).toBe("EXECUTE");
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
          binaryCheck: { ok: false, error: "not found", durationMs: 5 },
          authCheck: { ok: true, durationMs: 2 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 3 },
          authCheck: { ok: false, error: "unauthorized", durationMs: 4 },
        },
      ],
      ...overrides,
    };
  }

  it("names every runtime with a failing binary or auth check in the message", () => {
    const result = makeResult();
    const err = new PreflightError(result);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
    expect(err.result).toBe(result);
  });

  it("excludes runtimes whose binary and auth checks both passed", () => {
    const result = makeResult({
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "missing", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("produces an empty failure list in the message when all checks pass", () => {
    const result = makeResult({
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
