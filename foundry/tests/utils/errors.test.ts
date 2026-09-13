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
  it("sets message, rule, and name; is an instance of Error", () => {
    const err = new PolicyViolationError("file not allowed", "allowedPaths");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("file not allowed");
    expect(err.rule).toBe("allowedPaths");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("sets message, a fixed statusCode of 409, and name", () => {
    const err = new PolicyError("conflicting policy state");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("conflicting policy state");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("sets message, a fixed statusCode of 400, and name", () => {
    const err = new ValidationError("invalid payload");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("invalid payload");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("formats the message from agent name and timeoutMs, and exposes both as fields", () => {
    const err = new AgentTimeoutError("planner", 5000);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("sets message, name, and stores rawOutput when provided", () => {
    const err = new OutputParseError("could not parse JSON", "not-json-at-all");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("not-json-at-all");
    expect(err.name).toBe("OutputParseError");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("could not parse JSON");

    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("formats the message from fromState and event, and exposes both as fields", () => {
    const err = new StateTransitionError("PLANNING", "APPROVE");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "PLANNING" for event "APPROVE"');
    expect(err.fromState).toBe("PLANNING");
    expect(err.event).toBe("APPROVE");
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

  it("builds a message listing only the failing runtimes and stores the full result", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(summary);
  });

  it("excludes a runtime from the message when both checks pass", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "missing", durationMs: 2 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("produces an empty failure list in the message when all checks pass", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    });
    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
