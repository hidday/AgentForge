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
    const err = new PolicyViolationError("file is protected", "no-touch-secrets");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("file is protected");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("no-touch-secrets");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 statusCode", () => {
    const err = new PolicyError("policy violated");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("policy violated");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 statusCode", () => {
    const err = new ValidationError("invalid input");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("invalid input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds the message from the agent name and timeout, and exposes both as properties", () => {
    const err = new AgentTimeoutError("executor", 5000);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
  });
});

describe("OutputParseError", () => {
  it("sets message, name, and the optional rawOutput property when provided", () => {
    const err = new OutputParseError("could not parse JSON", "{ broken");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("could not parse JSON");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("{ broken");
  });

  it("leaves rawOutput undefined when not provided", () => {
    const err = new OutputParseError("could not parse JSON");

    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds the message from fromState and event, and exposes both as properties", () => {
    const err = new StateTransitionError("PLANNING", "APPROVE");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "PLANNING" for event "APPROVE"');
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("PLANNING");
    expect(err.event).toBe("APPROVE");
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

  it("lists every runtime that failed either the binary or auth check", () => {
    const summary = makeSummary();
    const err = new PreflightError(summary);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(summary);
  });

  it("lists only the runtime(s) that actually failed", () => {
    const summary = makeSummary({
      results: [
        {
          runtime: "claude-code",
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

  it("produces an empty failure list in the message when all checks pass", () => {
    const summary = makeSummary({
      ok: true,
      results: [
        {
          runtime: "claude-code",
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
