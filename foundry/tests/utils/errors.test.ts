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
  it("carries message, rule and name", () => {
    const err = new PolicyViolationError("bad diff", "max-files");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("bad diff");
    expect(err.rule).toBe("max-files");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("carries message, statusCode 409 and name", () => {
    const err = new PolicyError("conflicting policy state");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("conflicting policy state");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("carries message, statusCode 400 and name", () => {
    const err = new ValidationError("missing field");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("missing field");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("carries rawOutput when provided", () => {
    const err = new OutputParseError("could not parse JSON", "{not json");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("{not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
    expect(err.name).toBe("OutputParseError");
  });
});

describe("StateTransitionError", () => {
  it("builds a message from fromState and event, and exposes both fields", () => {
    const err = new StateTransitionError("Planning", "REVIEW_APPROVED");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "Planning" for event "REVIEW_APPROVED"');
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("REVIEW_APPROVED");
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
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: false, error: "no token", durationMs: 1 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only runtimes with a failing binary or auth check in the message", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(summary);
  });

  it("reports a runtime as failing when only the auth check fails", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: false, error: "unauthorized", durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });

  it("produces an empty failure list when every runtime passes", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
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
