import { describe, it, expect } from "vitest";
import { isTransientError, isDeterministicError } from "../../src/runtime/errorClassifier.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

describe("errorClassifier", () => {
  describe("isTransientError", () => {
    it("returns true for AgentTimeoutError", () => {
      expect(isTransientError(new AgentTimeoutError("claude", 30000))).toBe(true);
    });

    it("returns true for error with statusCode 429", () => {
      const err = Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
      expect(isTransientError(err)).toBe(true);
    });

    it("returns true for error with status 429", () => {
      const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
      expect(isTransientError(err)).toBe(true);
    });

    it("returns true for exit code 137 (OOM/SIGKILL)", () => {
      const err = Object.assign(new Error("Process killed"), { exitCode: 137 });
      expect(isTransientError(err)).toBe(true);
    });

    it("returns true for exit code 124 (timeout)", () => {
      const err = Object.assign(new Error("Process timed out"), { exitCode: 124 });
      expect(isTransientError(err)).toBe(true);
    });

    it("returns true for message containing 'timeout'", () => {
      expect(isTransientError(new Error("Connection timeout"))).toBe(true);
    });

    it("returns true for message containing 'timed out'", () => {
      expect(isTransientError(new Error("Request timed out"))).toBe(true);
    });

    it("returns true for message containing 'ETIMEDOUT'", () => {
      expect(isTransientError(new Error("ETIMEDOUT: connection timed out"))).toBe(true);
    });

    it("returns true for message containing 'ECONNRESET'", () => {
      expect(isTransientError(new Error("ECONNRESET: socket hang up"))).toBe(true);
    });

    it("returns true for message containing 'ECONNREFUSED'", () => {
      expect(isTransientError(new Error("ECONNREFUSED 127.0.0.1:8080"))).toBe(true);
    });

    it("returns true for message containing 'rate limit'", () => {
      expect(isTransientError(new Error("rate limit exceeded"))).toBe(true);
    });

    it("returns true for message containing 'out of memory'", () => {
      expect(isTransientError(new Error("JavaScript heap out of memory"))).toBe(true);
    });

    it("returns true for message containing 'OOM'", () => {
      expect(isTransientError(new Error("OOM killer triggered"))).toBe(true);
    });

    it("returns false for deterministic error (authentication)", () => {
      expect(isTransientError(new Error("authentication failed"))).toBe(false);
    });

    it("returns false for deterministic error (invalid api key)", () => {
      expect(isTransientError(new Error("Invalid API key provided"))).toBe(false);
    });

    it("returns false for deterministic error (model not found)", () => {
      expect(isTransientError(new Error("Model not found: gpt-99"))).toBe(false);
    });

    it("treats unknown errors as transient (fail-safe)", () => {
      expect(isTransientError(new Error("unknown mysterious failure"))).toBe(true);
    });

    it("does not throw for null input", () => {
      expect(() => isTransientError(null)).not.toThrow();
      expect(isTransientError(null)).toBe(true); // unknown → transient
    });

    it("does not throw for non-Error values", () => {
      expect(() => isTransientError("string error")).not.toThrow();
      expect(() => isTransientError(42)).not.toThrow();
      expect(() => isTransientError(undefined)).not.toThrow();
    });
  });

  describe("isDeterministicError", () => {
    it("returns true for 'authentication' message", () => {
      expect(isDeterministicError(new Error("authentication failed"))).toBe(true);
    });

    it("returns true for 'unauthorized' message", () => {
      expect(isDeterministicError(new Error("Unauthorized: 401"))).toBe(true);
    });

    it("returns true for 'invalid api key' message", () => {
      expect(isDeterministicError(new Error("Invalid API key"))).toBe(true);
    });

    it("returns true for 'invalid model' message", () => {
      expect(isDeterministicError(new Error("invalid model specified"))).toBe(true);
    });

    it("returns true for 'model not found' message", () => {
      expect(isDeterministicError(new Error("Model not found"))).toBe(true);
    });

    it("returns true for 'permission denied' message", () => {
      expect(isDeterministicError(new Error("permission denied for resource"))).toBe(true);
    });

    it("returns true for 'forbidden' message", () => {
      expect(isDeterministicError(new Error("403 Forbidden"))).toBe(true);
    });

    it("returns false for transient errors", () => {
      expect(isDeterministicError(new Error("ECONNRESET"))).toBe(false);
      expect(isDeterministicError(new Error("rate limit"))).toBe(false);
      expect(isDeterministicError(new Error("timeout"))).toBe(false);
    });

    it("returns false for unknown errors", () => {
      expect(isDeterministicError(new Error("some unknown error"))).toBe(false);
    });

    it("does not throw for null/non-Error values", () => {
      expect(() => isDeterministicError(null)).not.toThrow();
      expect(() => isDeterministicError(undefined)).not.toThrow();
      expect(() => isDeterministicError(42)).not.toThrow();
    });
  });
});
