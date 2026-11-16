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
    const err = new PolicyViolationError("No touching protected paths", "no-protected-paths");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("No touching protected paths");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("no-protected-paths");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 statusCode", () => {
    const err = new PolicyError("Policy violated");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Policy violated");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 statusCode", () => {
    const err = new ValidationError("Invalid input");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Invalid input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as properties", () => {
    const err = new AgentTimeoutError("executor", 120_000);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 120000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(120_000);
  });
});

describe("OutputParseError", () => {
  it("sets message, name, and the optional rawOutput when provided", () => {
    const err = new OutputParseError("Could not parse output", "not json");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Could not parse output");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("not json");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("Could not parse output");

    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from fromState and event, and exposes both as properties", () => {
    const err = new StateTransitionError("Todo", "approve-plan");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "Todo" for event "approve-plan"');
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("Todo");
    expect(err.event).toBe("approve-plan");
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
          authCheck: { ok: true, durationMs: 3 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: false, error: "not authenticated", durationMs: 1 },
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
    expect(err.message).toBe("Preflight failed for runtimes: codex");
    expect(err.result).toBe(summary);
  });

  it("lists multiple failing runtimes, including one that fails only the authCheck", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 5 },
          authCheck: { ok: false, error: "no token", durationMs: 1 },
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

    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
  });

  it("produces an empty failure list in the message when every result passes", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 5 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });

    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
