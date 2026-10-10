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
  it("sets name, message, and the custom rule field", () => {
    const err = new PolicyViolationError("blocked by policy", "no-force-push");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyViolationError");
    expect(err.message).toBe("blocked by policy");
    expect(err.rule).toBe("no-force-push");
  });
});

describe("PolicyError", () => {
  it("sets name, message, and statusCode 409", () => {
    const err = new PolicyError("conflicting policy state");
    expect(err.name).toBe("PolicyError");
    expect(err.message).toBe("conflicting policy state");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets name, message, and statusCode 400", () => {
    const err = new ValidationError("invalid payload");
    expect(err.name).toBe("ValidationError");
    expect(err.message).toBe("invalid payload");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("sets name, a formatted message, and the agent/timeoutMs fields", () => {
    const err = new AgentTimeoutError("executor", 120_000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.message).toBe('Agent "executor" timed out after 120000ms');
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(120_000);
  });
});

describe("OutputParseError", () => {
  it("sets name, message, and the optional rawOutput field when provided", () => {
    const err = new OutputParseError("could not parse JSON", "not json {{{");
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("not json {{{");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("sets name, a formatted message, and the fromState/event fields", () => {
    const err = new StateTransitionError("Planning", "approve");
    expect(err.name).toBe("StateTransitionError");
    expect(err.message).toBe('No transition from state "Planning" for event "approve"');
    expect(err.fromState).toBe("Planning");
    expect(err.event).toBe("approve");
  });
});

describe("PreflightError", () => {
  function makeResult(overrides: Partial<PreflightSummary> = {}): PreflightSummary {
    return {
      ok: false,
      requiredRuntimes: ["claude", "codex", "cursor"],
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 5 },
          authCheck: { ok: true, durationMs: 3 },
        },
        {
          runtime: "codex",
          command: "codex",
          binaryCheck: { ok: false, error: "not found", durationMs: 2 },
          authCheck: { ok: true, durationMs: 1 },
        },
        {
          runtime: "cursor",
          command: "agent",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 4 },
          authCheck: { ok: false, error: "unauthorized", durationMs: 6 },
        },
      ],
      ...overrides,
    };
  }

  it("lists only the failing runtimes in the message, in result order", () => {
    const result = makeResult();
    const err = new PreflightError(result);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: codex, cursor");
    expect(err.message).not.toContain("claude");
  });

  it("stores the full PreflightSummary on the .result field", () => {
    const result = makeResult();
    const err = new PreflightError(result);
    expect(err.result).toBe(result);
    expect(err.result.requiredRuntimes).toEqual(["claude", "codex", "cursor"]);
  });

  it("produces an empty failures list in the message when all runtimes pass", () => {
    const result: PreflightSummary = {
      ok: true,
      requiredRuntimes: ["claude"],
      results: [
        {
          runtime: "claude",
          command: "claude",
          binaryCheck: { ok: true, version: "1.0.0", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    };
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
