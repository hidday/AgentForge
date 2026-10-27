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
  it("carries the message and rule, and sets name", () => {
    const err = new PolicyViolationError("touched a protected path", "no-protected-paths");
    expect(err.message).toBe("touched a protected path");
    expect(err.rule).toBe("no-protected-paths");
    expect(err.name).toBe("PolicyViolationError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("sets statusCode 409 and name", () => {
    const err = new PolicyError("conflicting policy");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
    expect(err.message).toBe("conflicting policy");
  });
});

describe("ValidationError", () => {
  it("sets statusCode 400 and name", () => {
    const err = new ValidationError("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from agent name and timeout, and exposes both as fields", () => {
    const err = new AgentTimeoutError("executor", 60_000);
    expect(err.message).toBe('Agent "executor" timed out after 60000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(60_000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("OutputParseError", () => {
  it("carries the message and optional rawOutput", () => {
    const err = new OutputParseError("could not parse JSON", "not json at all");
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("not json at all");
    expect(err.name).toBe("OutputParseError");
  });

  it("allows rawOutput to be omitted", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from fromState and event, and exposes both as fields", () => {
    const err = new StateTransitionError("planning", "approve");
    expect(err.message).toBe('No transition from state "planning" for event "approve"');
    expect(err.fromState).toBe("planning");
    expect(err.event).toBe("approve");
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
          command: "claude --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: false, durationMs: 5, error: "not logged in" },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
      ...overrides,
    };
  }

  it("lists the runtimes that failed either the binary or auth check", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
    expect(err.name).toBe("PreflightError");
    expect(err.result).toBe(summary);
  });

  it("lists only the failing runtime when just one check fails", () => {
    const summary = makeSummary({
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
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });

  it("lists no runtimes in the message when all checks pass (ok summary)", () => {
    const summary = makeSummary({
      ok: true,
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
