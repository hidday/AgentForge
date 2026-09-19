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
  it("carries the message and rule, and sets name/instanceof", () => {
    const err = new PolicyViolationError("File is protected", "no-protected-paths");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("File is protected");
    expect(err.rule).toBe("no-protected-paths");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("sets a 409 statusCode and the message", () => {
    const err = new PolicyError("Cannot transition run");
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("Cannot transition run");
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("sets a 400 statusCode and the message", () => {
    const err = new ValidationError("Missing required field");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Missing required field");
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as fields", () => {
    const err = new AgentTimeoutError("planner", 120_000);
    expect(err.message).toBe('Agent "planner" timed out after 120000ms');
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(120_000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("OutputParseError", () => {
  it("stores the raw output when provided", () => {
    const err = new OutputParseError("Invalid JSON", "{not json");
    expect(err.message).toBe("Invalid JSON");
    expect(err.rawOutput).toBe("{not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("Invalid JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both as fields", () => {
    const err = new StateTransitionError("PlanApproved", "reject");
    expect(err.message).toBe('No transition from state "PlanApproved" for event "reject"');
    expect(err.fromState).toBe("PlanApproved");
    expect(err.event).toBe("reject");
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
          binaryCheck: { ok: false, error: "not found", durationMs: 5 },
          authCheck: { ok: true, durationMs: 2 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: true, version: "1.2.3", durationMs: 4 },
          authCheck: { ok: false, error: "unauthenticated", durationMs: 3 },
        },
        {
          runtime: "cursor",
          command: "agent --version",
          binaryCheck: { ok: true, version: "0.9.0", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
      ...overrides,
    };
  }

  it("names only the runtimes that failed the binary or auth check", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
    expect(err.name).toBe("PreflightError");
  });

  it("exposes the full preflight summary on the result field", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);
    expect(err.result).toBe(summary);
    expect(err.result.ok).toBe(false);
    expect(err.result.results).toHaveLength(3);
  });

  it("produces an empty failure list in the message when every runtime passed both checks", () => {
    const summary = makeSummary({
      ok: true,
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 5 },
          authCheck: { ok: true, durationMs: 2 },
        },
      ],
    });
    const err = new PreflightError(summary);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });

  it("is an instance of Error", () => {
    const err = new PreflightError(makeSummary());
    expect(err).toBeInstanceOf(Error);
  });
});
