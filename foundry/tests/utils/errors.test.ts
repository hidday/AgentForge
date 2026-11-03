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

describe("utils/errors", () => {
  describe("PolicyViolationError", () => {
    it("carries the message and rule, and is a real Error", () => {
      const err = new PolicyViolationError("file touches protected path", "protected-path");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("PolicyViolationError");
      expect(err.message).toBe("file touches protected path");
      expect(err.rule).toBe("protected-path");
    });
  });

  describe("PolicyError", () => {
    it("has a fixed statusCode of 409", () => {
      const err = new PolicyError("plan not approved");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("PolicyError");
      expect(err.message).toBe("plan not approved");
      expect(err.statusCode).toBe(409);
    });
  });

  describe("ValidationError", () => {
    it("has a fixed statusCode of 400", () => {
      const err = new ValidationError("missing required field");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("ValidationError");
      expect(err.message).toBe("missing required field");
      expect(err.statusCode).toBe(400);
    });
  });

  describe("AgentTimeoutError", () => {
    it("builds a message from the agent name and timeout, and exposes both fields", () => {
      const err = new AgentTimeoutError("executor", 60_000);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("AgentTimeoutError");
      expect(err.message).toBe('Agent "executor" timed out after 60000ms');
      expect(err.agent).toBe("executor");
      expect(err.timeoutMs).toBe(60_000);
    });
  });

  describe("OutputParseError", () => {
    it("preserves the message and optional rawOutput when provided", () => {
      const err = new OutputParseError("could not parse JSON", "not json at all");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("OutputParseError");
      expect(err.message).toBe("could not parse JSON");
      expect(err.rawOutput).toBe("not json at all");
    });

    it("leaves rawOutput undefined when omitted", () => {
      const err = new OutputParseError("could not parse JSON");
      expect(err.rawOutput).toBeUndefined();
    });
  });

  describe("StateTransitionError", () => {
    it("builds a message describing the invalid transition and exposes fromState/event", () => {
      const err = new StateTransitionError("Todo", "approve");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("StateTransitionError");
      expect(err.message).toBe('No transition from state "Todo" for event "approve"');
      expect(err.fromState).toBe("Todo");
      expect(err.event).toBe("approve");
    });
  });

  describe("PreflightError", () => {
    function makeResult(overrides: Partial<PreflightSummary> = {}): PreflightSummary {
      return {
        ok: false,
        requiredRuntimes: ["claude", "codex"],
        results: [
          {
            runtime: "claude",
            command: "claude --version",
            binaryCheck: { ok: false, durationMs: 5, error: "not found" },
            authCheck: { ok: true, durationMs: 1 },
          },
          {
            runtime: "codex",
            command: "codex --version",
            binaryCheck: { ok: true, version: "1.0.0", durationMs: 3 },
            authCheck: { ok: false, durationMs: 2, error: "unauthorized" },
          },
          {
            runtime: "cursor",
            command: "agent --version",
            binaryCheck: { ok: true, version: "2.0.0", durationMs: 4 },
            authCheck: { ok: true, durationMs: 1 },
          },
        ],
        ...overrides,
      };
    }

    it("builds a message listing only the failing runtimes (bad binary or bad auth)", () => {
      const result = makeResult();
      const err = new PreflightError(result);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("PreflightError");
      expect(err.message).toBe("Preflight failed for runtimes: claude, codex");
      expect(err.result).toBe(result);
    });

    it("lists no runtimes when every binary and auth check passes", () => {
      const result = makeResult({
        ok: true,
        results: [
          {
            runtime: "claude",
            command: "claude --version",
            binaryCheck: { ok: true, version: "1.0.0", durationMs: 5 },
            authCheck: { ok: true, durationMs: 1 },
          },
        ],
      });
      const err = new PreflightError(result);
      expect(err.message).toBe("Preflight failed for runtimes: ");
    });
  });
});
