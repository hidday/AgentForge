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
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("touched a protected path");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.rule).toBe("no-protected-paths");
  });
});

describe("PolicyError", () => {
  it("sets message, name, and a 409 status code", () => {
    const err = new PolicyError("policy conflict");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("policy conflict");
    expect(err.name).toBe("PolicyError");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets message, name, and a 400 status code", () => {
    const err = new ValidationError("bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("bad input");
    expect(err.name).toBe("ValidationError");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout, and exposes both fields", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
  });

  it("reflects a different agent/timeout pair in the message", () => {
    const err = new AgentTimeoutError("planner", 120_000);
    expect(err.message).toBe('Agent "planner" timed out after 120000ms');
    expect(err.agent).toBe("planner");
    expect(err.timeoutMs).toBe(120_000);
  });
});

describe("OutputParseError", () => {
  it("sets message, name, and optional raw output when provided", () => {
    const err = new OutputParseError("could not parse JSON", "not json");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("could not parse JSON");
    expect(err.name).toBe("OutputParseError");
    expect(err.rawOutput).toBe("not json");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("could not parse JSON");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event, and exposes both fields", () => {
    const err = new StateTransitionError("PLANNING", "approve");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('No transition from state "PLANNING" for event "approve"');
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("PLANNING");
    expect(err.event).toBe("approve");
  });
});

describe("PreflightError", () => {
  const makeResult = (
    overrides: Partial<PreflightSummary["results"][number]> = {},
  ): PreflightSummary["results"][number] => ({
    runtime: "claude",
    command: "claude --version",
    binaryCheck: { ok: true, version: "1.0.0", durationMs: 10 },
    authCheck: { ok: true, durationMs: 5 },
    ...overrides,
  });

  it("lists runtimes with a failing binary check in the message", () => {
    const result: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude", "codex"],
      results: [
        makeResult({ runtime: "claude", binaryCheck: { ok: false, error: "not found", durationMs: 3 } }),
        makeResult({ runtime: "codex" }),
      ],
    };
    const err = new PreflightError(result);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude");
    expect(err.result).toBe(result);
  });

  it("lists runtimes with a failing auth check in the message", () => {
    const result: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["cursor"],
      results: [makeResult({ runtime: "cursor", authCheck: { ok: false, durationMs: 2, error: "unauthorized" } })],
    };
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: cursor");
  });

  it("joins multiple failing runtimes with a comma", () => {
    const result: PreflightSummary = {
      ok: false,
      requiredRuntimes: ["claude", "codex", "cursor"],
      results: [
        makeResult({ runtime: "claude", binaryCheck: { ok: false, durationMs: 1 } }),
        makeResult({ runtime: "codex", authCheck: { ok: false, durationMs: 1 } }),
        makeResult({ runtime: "cursor" }),
      ],
    };
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
  });

  it("produces an empty failures list in the message when all checks pass", () => {
    const result: PreflightSummary = {
      ok: true,
      requiredRuntimes: ["claude"],
      results: [makeResult()],
    };
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
