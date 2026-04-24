import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { CircuitBreaker } from "../../src/runtime/circuitBreaker.js";
import { RetryExhaustedError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions, ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
}

const CLEAN_RESULT: ProcessResult = {
  stdout: "{}",
  stderr: "",
  exitCode: 0,
  durationMs: 10,
  timedOut: false,
};

const BASE_OPTIONS: ProcessSpawnOptions = {
  command: "echo",
  args: ["hello"],
  cwd: "/tmp",
  timeoutMs: 5000,
  context: { runId: "run-1", stage: "planning", runtime: "claude-code" },
};

describe("ProcessRunner retry loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("RETRY_MAX_ATTEMPTS=0 → single attempt, no retry", async () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(5, 60_000, logger as never);
    const runner = new ProcessRunner("mock", logger as never, undefined, "/tmp/spool", cb, 0, 1000);

    let callCount = 0;
    runner.setMockHandler(async () => {
      callCount++;
      return CLEAN_RESULT;
    });

    await runner.execute(BASE_OPTIONS);
    expect(callCount).toBe(1);
  });

  it("RETRY_MAX_ATTEMPTS=0 → propagates normalizeResult error without retry", async () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(5, 60_000, logger as never);
    const runner = new ProcessRunner("mock", logger as never, undefined, "/tmp/spool", cb, 0, 1000);

    let callCount = 0;
    runner.setMockHandler(async () => {
      callCount++;
      return { ...CLEAN_RESULT, exitCode: 137 }; // OOM
    });

    await expect(runner.execute(BASE_OPTIONS)).rejects.toThrow(/out of memory/i);
    expect(callCount).toBe(1);
  });

  it("transient error retried up to maxAttempts → throws RetryExhaustedError", async () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(10, 60_000, logger as never); // high threshold so CB doesn't open
    const runner = new ProcessRunner("mock", logger as never, undefined, "/tmp/spool", cb, 3, 100);

    let callCount = 0;
    runner.setMockHandler(async () => {
      callCount++;
      throw new Error("ECONNRESET socket hang up");
    });

    const executePromise = runner.execute(BASE_OPTIONS);
    // Attach rejection handler BEFORE running timers to prevent unhandled rejection warning
    const assertion = expect(executePromise).rejects.toBeInstanceOf(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(callCount).toBe(3);
  });

  it("RetryExhaustedError has correct attempts array", async () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(10, 60_000, logger as never);
    const runner = new ProcessRunner("mock", logger as never, undefined, "/tmp/spool", cb, 2, 100);

    runner.setMockHandler(async () => {
      throw new Error("ECONNRESET");
    });

    const executePromise = runner.execute(BASE_OPTIONS);
    // Attach handler before timer run to prevent unhandled rejection
    executePromise.catch(() => {});
    await vi.runAllTimersAsync();

    let caughtErr: unknown;
    try {
      await executePromise;
      expect.fail("Should have thrown");
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeInstanceOf(RetryExhaustedError);
    const re = caughtErr as RetryExhaustedError;
    expect(re.attempts).toHaveLength(2);
    expect(re.attempts[0].attempt).toBe(1);
    expect(re.attempts[1].attempt).toBe(2);
    expect(re.circuitBreakerTriggered).toBe(false);
    expect(re.stage).toBe("planning");
    expect(re.runtime).toBe("claude-code");
  });

  it("deterministic error is rethrown immediately without retrying", async () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(10, 60_000, logger as never);
    const runner = new ProcessRunner("mock", logger as never, undefined, "/tmp/spool", cb, 3, 100);

    let callCount = 0;
    runner.setMockHandler(async () => {
      callCount++;
      throw new Error("Invalid API key provided");
    });

    await expect(runner.execute(BASE_OPTIONS)).rejects.toThrow("Invalid API key provided");
    expect(callCount).toBe(1);
  });

  it("success on second attempt → recordSuccess called, result returned", async () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(10, 60_000, logger as never);
    const cbSpy = vi.spyOn(cb, "recordSuccess");
    const runner = new ProcessRunner("mock", logger as never, undefined, "/tmp/spool", cb, 3, 100);

    let callCount = 0;
    runner.setMockHandler(async () => {
      callCount++;
      if (callCount === 1) throw new Error("ECONNRESET");
      return CLEAN_RESULT;
    });

    const executePromise = runner.execute(BASE_OPTIONS);
    await vi.runAllTimersAsync();

    const result = await executePromise;
    expect(result).toEqual(CLEAN_RESULT);
    expect(callCount).toBe(2);
    expect(cbSpy).toHaveBeenCalledWith("planning:claude-code");
  });

  it("circuit breaker already open → RetryExhaustedError(circuitBreakerTriggered: true) without calling executeOnce", async () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(2, 60_000, logger as never);
    // Force open the circuit breaker
    cb.recordFailure("planning:claude-code");
    cb.recordFailure("planning:claude-code");
    expect(cb.isOpen("planning:claude-code")).toBe(true);

    const runner = new ProcessRunner("mock", logger as never, undefined, "/tmp/spool", cb, 3, 100);

    let callCount = 0;
    runner.setMockHandler(async () => {
      callCount++;
      return CLEAN_RESULT;
    });

    await expect(runner.execute(BASE_OPTIONS)).rejects.toBeInstanceOf(RetryExhaustedError);

    const error = await runner.execute(BASE_OPTIONS).catch((e) => e as RetryExhaustedError);
    expect(error).toBeInstanceOf(RetryExhaustedError);
    expect(error.circuitBreakerTriggered).toBe(true);
    expect(error.attempts).toEqual([]);
    expect(callCount).toBe(0); // executeOnce was never called
  });

  it("execute without context falls through to underlying execution without retry", async () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(5, 60_000, logger as never);
    const runner = new ProcessRunner("mock", logger as never, undefined, "/tmp/spool", cb, 3, 100);

    let callCount = 0;
    runner.setMockHandler(async () => {
      callCount++;
      return CLEAN_RESULT;
    });

    const optionsWithoutContext: ProcessSpawnOptions = { ...BASE_OPTIONS, context: undefined };
    const result = await runner.execute(optionsWithoutContext);
    expect(result).toEqual(CLEAN_RESULT);
    expect(callCount).toBe(1);
  });

  it("normalizeResult exit code 137 is treated as transient and retried", async () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(10, 60_000, logger as never);
    const runner = new ProcessRunner("mock", logger as never, undefined, "/tmp/spool", cb, 2, 100);

    let callCount = 0;
    runner.setMockHandler(async () => {
      callCount++;
      return { ...CLEAN_RESULT, exitCode: 137 };
    });

    const executePromise = runner.execute(BASE_OPTIONS);
    // Attach rejection handler before timer run
    executePromise.catch(() => {});
    await vi.runAllTimersAsync();

    let caughtErr: unknown;
    try {
      await executePromise;
      expect.fail("Should have thrown");
    } catch (e) {
      caughtErr = e;
    }

    expect(caughtErr).toBeInstanceOf(RetryExhaustedError);
    expect(callCount).toBe(2);
  });
});
