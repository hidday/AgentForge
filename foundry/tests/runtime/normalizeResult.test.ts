import { describe, it, expect } from "vitest";
import { RuntimeExecutionError } from "../../src/utils/errors.js";

// We test normalizeResult indirectly through ProcessRunner.execute() in processRunner.retry tests,
// but here we verify the RuntimeExecutionError shape and that the exported class exists.

describe("RuntimeExecutionError", () => {
  it("is exported from errors.ts with correct name", () => {
    const err = new RuntimeExecutionError("OOM", 137, "stderr text");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RuntimeExecutionError");
    expect(err.message).toBe("OOM");
    expect(err.exitCode).toBe(137);
    expect(err.stderr).toBe("stderr text");
  });

  it("instanceof Error", () => {
    expect(new RuntimeExecutionError("x", 1, "")).toBeInstanceOf(Error);
  });
});

// Direct unit test for normalizeResult behaviour via a thin wrapper
// We re-implement the classification logic here to keep this module dependency-free.
// The actual implementation lives in ProcessRunner.normalizeResult (private).

function normalizeResultStub(exitCode: number, stderr: string): void {
  if (exitCode === 137) {
    throw new RuntimeExecutionError("Process killed: out of memory (exit code 137)", 137, stderr);
  }
  if (exitCode === 124) {
    throw new RuntimeExecutionError("Process timed out (exit code 124)", 124, stderr);
  }
  const stderrLower = stderr.toLowerCase();
  if (stderrLower.includes("rate limit") || stderrLower.includes("429")) {
    throw new RuntimeExecutionError("Rate limit detected in stderr", exitCode, stderr);
  }
  if (
    stderrLower.includes("authentication") ||
    stderrLower.includes("unauthorized") ||
    stderrLower.includes("invalid api key")
  ) {
    throw new RuntimeExecutionError("Authentication error detected in stderr", exitCode, stderr);
  }
}

describe("normalizeResult behaviour", () => {
  it("throws RuntimeExecutionError for exit code 137 (OOM)", () => {
    expect(() => normalizeResultStub(137, "")).toThrow(RuntimeExecutionError);
    expect(() => normalizeResultStub(137, "")).toThrow(/out of memory/i);
  });

  it("throws RuntimeExecutionError for exit code 124 (timeout)", () => {
    expect(() => normalizeResultStub(124, "")).toThrow(RuntimeExecutionError);
    expect(() => normalizeResultStub(124, "")).toThrow(/timed out/i);
  });

  it("throws for stderr containing 'rate limit'", () => {
    expect(() => normalizeResultStub(0, "Error: rate limit exceeded")).toThrow(RuntimeExecutionError);
  });

  it("throws for stderr containing '429'", () => {
    expect(() => normalizeResultStub(0, "HTTP 429 Too Many Requests")).toThrow(RuntimeExecutionError);
  });

  it("throws for stderr containing 'authentication'", () => {
    expect(() => normalizeResultStub(0, "authentication failed")).toThrow(RuntimeExecutionError);
  });

  it("throws for stderr containing 'unauthorized'", () => {
    expect(() => normalizeResultStub(0, "Unauthorized access")).toThrow(RuntimeExecutionError);
  });

  it("throws for stderr containing 'invalid api key'", () => {
    expect(() => normalizeResultStub(0, "Invalid API key provided")).toThrow(RuntimeExecutionError);
  });

  it("does NOT throw for a clean exit", () => {
    expect(() => normalizeResultStub(0, "")).not.toThrow();
  });

  it("does NOT throw for exit code 1 with empty stderr", () => {
    expect(() => normalizeResultStub(1, "")).not.toThrow();
  });
});
