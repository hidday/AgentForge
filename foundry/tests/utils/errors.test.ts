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
  it("sets message, name, and the offending rule", () => {
    const err = new PolicyViolationError("touched a protected path", "no-protected-paths");
    expect(err.message).toBe("touched a protected path");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("no-protected-paths");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 status code", () => {
    const err = new PolicyError("cannot transition");
    expect(err.message).toBe("cannot transition");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 status code", () => {
    const err = new ValidationError("bad input");
    expect(err.message).toBe("bad input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("executor", 60000);
    expect(err.message).toBe('Agent "executor" timed out after 60000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(60000);
  });
});

describe("OutputParseError", () => {
  it("stores the message and optional raw output", () => {
    const err = new OutputParseError("could not find delimiter", "...raw tail...");
    expect(err.message).toBe("could not find delimiter");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("...raw tail...");
  });

  it("allows rawOutput to be omitted", () => {
    const err = new OutputParseError("no output at all");
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
  function makeSummary(overrides: Partial<PreflightSummary> = {}): PreflightSummary {
    return {
      ok: false,
      requiredRuntimes: ["claude", "codex"],
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 5 },
          authCheck: { ok: false, error: "not logged in", durationMs: 5 },
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

  it("lists every runtime that failed either the binary or auth check in the message", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
    expect(err.result).toBe(summary);
  });

  it("omits runtimes that passed both checks", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 5 },
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

  it("produces an empty failures list in the message when everything passed", () => {
    const summary = makeSummary({
      ok: true,
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 5 },
          authCheck: { ok: true, durationMs: 5 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
