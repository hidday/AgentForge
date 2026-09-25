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
  it("sets message, name, and the rule field", () => {
    const err = new PolicyViolationError("File not allowed", "allowedPaths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("File not allowed");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("allowedPaths");
  });
});

describe("PolicyError", () => {
  it("sets message, name and a fixed statusCode of 409", () => {
    const err = new PolicyError("Diff too large");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Diff too large");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name and a fixed statusCode of 400", () => {
    const err = new ValidationError("Missing required field");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Missing required field");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeoutMs, and exposes both as fields", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
  });
});

describe("OutputParseError", () => {
  it("sets message, name, and the optional rawOutput field when provided", () => {
    const err = new OutputParseError("Could not find structured output", "garbage text");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Could not find structured output");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("garbage text");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("Could not find structured output");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from fromState and event, and exposes both as fields", () => {
    const err = new StateTransitionError("Done", "RUN_REQUESTED");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "Done" for event "RUN_REQUESTED"');
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("Done");
    expect(err.event).toBe("RUN_REQUESTED");
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
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: false, durationMs: 5, error: "not logged in" },
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
    const result = makeResult();
    const err = new PreflightError(result);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(result);
  });

  it("lists no runtimes in the message when every check passed", () => {
    const result = makeResult({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });

  it("lists a runtime only once even when both binaryCheck and authCheck failed", () => {
    const result = makeResult({
      results: [
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: false, error: "missing", durationMs: 1 },
          authCheck: { ok: false, error: "unauthorized", durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });
});
