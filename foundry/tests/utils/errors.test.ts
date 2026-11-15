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
  it("carries the message and rule name", () => {
    const err = new PolicyViolationError("file not allowed", "allowedPaths");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyViolationError");
    expect(err.message).toBe("file not allowed");
    expect(err.rule).toBe("allowedPaths");
  });
});

describe("PolicyError", () => {
  it("sets a 409 status code", () => {
    const err = new PolicyError("conflicting policy");
    expect(err.name).toBe("PolicyError");
    expect(err.message).toBe("conflicting policy");
    expect(err.statusCode).toBe(409);
  });
});

describe("ValidationError", () => {
  it("sets a 400 status code", () => {
    const err = new ValidationError("bad input");
    expect(err.name).toBe("ValidationError");
    expect(err.message).toBe("bad input");
    expect(err.statusCode).toBe(400);
  });
});

describe("AgentTimeoutError", () => {
  it("builds a message from the agent name and timeout", () => {
    const err = new AgentTimeoutError("executor", 5000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.agent).toBe("executor");
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toBe('Agent "executor" timed out after 5000ms');
  });
});

describe("OutputParseError", () => {
  it("retains the raw output when provided", () => {
    const err = new OutputParseError("could not parse", "{not json");
    expect(err.name).toBe("OutputParseError");
    expect(err.message).toBe("could not parse");
    expect(err.rawOutput).toBe("{not json");
  });

  it("leaves rawOutput undefined when omitted", () => {
    const err = new OutputParseError("could not parse");
    expect(err.rawOutput).toBeUndefined();
  });
});

describe("StateTransitionError", () => {
  it("builds a message from the from-state and event", () => {
    const err = new StateTransitionError("InReview", "approve-plan");
    expect(err.name).toBe("StateTransitionError");
    expect(err.fromState).toBe("InReview");
    expect(err.event).toBe("approve-plan");
    expect(err.message).toBe('No transition from state "InReview" for event "approve-plan"');
  });
});

describe("PreflightError", () => {
  function makeResult(overrides: Partial<PreflightSummary["results"][number]>[]): PreflightSummary {
    return {
      ok: false,
      requiredRuntimes: ["claude-code", "codex"],
      results: overrides.map((r, i) => ({
        runtime: r.runtime ?? `runtime-${i}`,
        command: r.command ?? "cmd",
        binaryCheck: r.binaryCheck ?? { ok: true, durationMs: 1 },
        authCheck: r.authCheck ?? { ok: true, durationMs: 1 },
      })),
    };
  }

  it("lists only the runtimes that failed binary or auth checks", () => {
    const result = makeResult([
      { runtime: "claude-code", binaryCheck: { ok: false, error: "missing binary", durationMs: 1 } },
      { runtime: "codex", authCheck: { ok: false, error: "no auth", durationMs: 1 } },
      { runtime: "cursor" },
    ]);
    const err = new PreflightError(result);
    expect(err.name).toBe("PreflightError");
    expect(err.message).toBe("Preflight failed for runtimes: claude-code, codex");
    expect(err.result).toBe(result);
  });

  it("produces an empty failure list when every runtime passes", () => {
    const result = makeResult([{ runtime: "claude-code" }]);
    const err = new PreflightError(result);
    expect(err.message).toBe("Preflight failed for runtimes: ");
  });
});
