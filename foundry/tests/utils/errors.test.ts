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
  it("exposes message, rule, and name; is an instanceof Error", () => {
    const err = new PolicyViolationError("no touching prod", "no-prod-writes");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.message).toBe("no touching prod");
    expect(err.rule).toBe("no-prod-writes");
    expect(err.name).toBe("PolicyViolationError");
  });
});

describe("PolicyError", () => {
  it("exposes message, a 409 statusCode, and name", () => {
    const err = new PolicyError("policy check failed");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PolicyError);
    expect(err.message).toBe("policy check failed");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("PolicyError");
  });
});

describe("ValidationError", () => {
  it("exposes message, a 400 statusCode, and name", () => {
    const err = new ValidationError("bad input");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both as fields", () => {
    const err = new AgentTimeoutError("executor", 5000);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AgentTimeoutError);
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.name).toBe("AgentTimeoutError");
  });
});

describe("OutputParseError", () => {
  it("exposes the raw output when provided", () => {
    const err = new OutputParseError("could not parse JSON", "{not json");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OutputParseError);
    expect(err.message).toBe("could not parse JSON");
    expect(err.rawOutput).toBe("{not json");
    expect(err.name).toBe("OutputParseError");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("could not parse JSON");

    expect(err.rawOutput).toBeUndefined();
    expect(err.message).toBe("could not parse JSON");
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both as fields", () => {
    const err = new StateTransitionError("planning", "approve");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StateTransitionError);
    expect(err.fromState).toBe("planning");
    expect(err.event).toBe("approve");
    expect(err.message).toBe('No transition from state "planning" for event "approve"');
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
          authCheck: { ok: true, durationMs: 5 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "not found", durationMs: 3 },
          authCheck: { ok: true, durationMs: 2 },
        },
      ],
      ...overrides,
    };
  }

  it("stores the full result and lists only the runtimes that failed a check", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PreflightError);
    expect(err.result).toBe(summary);
    expect(err.message).toBe("Preflight failed for runtimes: codex");
    expect(err.name).toBe("PreflightError");
  });

  it("includes a runtime that fails only the auth check", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "cursor",
          command: "agent --version",
          binaryCheck: { ok: true, version: "2.0.0", durationMs: 1 },
          authCheck: { ok: false, error: "unauthenticated", durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });

  it("lists multiple failing runtimes joined by a comma", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: false, error: "missing", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
        {
          runtime: "codex",
          command: "codex --version",
          binaryCheck: { ok: false, error: "missing", durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
  });

  it("produces an empty failure list in the message when every check passed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude",
          command: "claude --version",
          binaryCheck: { ok: true, durationMs: 1 },
          authCheck: { ok: true, durationMs: 1 },
        },
      ],
    });
    const err = new PreflightError(summary);

    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
