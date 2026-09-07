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
    const err = new PolicyViolationError("cannot do that", "some_rule");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("cannot do that");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("some_rule");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 status code", () => {
    const err = new PolicyError("conflict occurred");
    expect(err.message).toBe("conflict occurred");
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
  it("builds a message from the agent name and timeout, and exposes both as properties", () => {
    const err = new AgentTimeoutError("planner", 5000);
    expect(err.message).toBe('Agent "planner" timed out after 5000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(5000);
  });
});

describe("OutputParseError", () => {
  it("stores the message and optional rawOutput", () => {
    const err = new OutputParseError("could not parse", "raw text snippet");
    expect(err.message).toBe("could not parse");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("raw text snippet");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("could not parse");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message including the from-state and event, and exposes both as properties", () => {
    const err = new StateTransitionError("Todo", "PLAN_APPROVED");
    expect(err.message).toBe('No transition from state "Todo" for event "PLAN_APPROVED"');
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("Todo");
    expect(err.event).toBe("PLAN_APPROVED");
  });
});

describe("PreflightError", () => {
  it("lists only failing runtimes in the message and stores the full result", () => {
    const result: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude-code", "codex", "cursor"],
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
          binaryCheck: { ok: false, error: "not found", durationMs: 1 },
          authCheck: { ok: true, durationMs: 2 },
        },
        {
          runtime: "cursor",
          command: "cursor",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 4 },
          authCheck: { ok: false, error: "unauthenticated", durationMs: 6 },
        },
      ],
    };

    const err = new PreflightError(result);

    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: codex, cursor");
    expect(err.result).toBe(result);
  });

  it("reports no failing runtimes in the message when all checks pass", () => {
    const result: PreflightSummary = {
      ok: true,
      requiredRuntimes: ["claude-code"],
      results: [
        {
          runtime: "claude-code",
          command: "claude",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    };

    const err = new PreflightError(result);

    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
