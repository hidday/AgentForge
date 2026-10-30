import { describe, it, expect } from "vitest";
import {
  AgentTimeoutError,
  OutputParseError,
  StateTransitionError,
  PreflightError,
  type PreflightSummary,
} from "../../src/utils/errors.js";

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("OutputParseError", () => {
  it("carries the raw output when provided", () => {
    const err = new OutputParseError("bad json", "{not json");
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("bad json");
    expect(err.rawOutput).toBe("{not json");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("bad json");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both fields", () => {
    const err = new StateTransitionError("Planning", "approve-plan");
    expect(err.name).toBe("StateTransitionError");
    expect(err.message).toBe('No transition from state "Planning" for event "approve-plan"');
    expect(err.fromState).toBe("Planning");
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
          command: "claude --version",
          binaryCheck: { ok: false, error: "not found", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 8 },
          authCheck: { ok: false, error: "unauthenticated", durationMs: 12 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the runtimes that failed either check, and stores the full result", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(summary);
  });

  it("omits runtimes where both checks passed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
          command: "claude --version",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 10 },
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "missing", durationMs: 8 },
          authCheck: { ok: true, durationMs: 12 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
  });
});
