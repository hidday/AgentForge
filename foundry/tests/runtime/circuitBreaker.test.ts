import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker } from "../../src/runtime/circuitBreaker.js";

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

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("isOpen returns false when below threshold", () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(3, 60_000, logger as never);

    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime");

    expect(cb.isOpen("stage:runtime")).toBe(false);
  });

  it("isOpen returns true at threshold", () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(3, 60_000, logger as never);

    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime");

    expect(cb.isOpen("stage:runtime")).toBe(true);
  });

  it("isOpen returns true above threshold", () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(3, 60_000, logger as never);

    for (let i = 0; i < 5; i++) {
      cb.recordFailure("stage:runtime");
    }

    expect(cb.isOpen("stage:runtime")).toBe(true);
  });

  it("records open event when transitioning from closed to open", () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(3, 60_000, logger as never);

    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime");
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "circuit_breaker_opened" }),
      expect.any(String),
    );

    cb.recordFailure("stage:runtime"); // crosses threshold
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "circuit_breaker_opened", key: "stage:runtime" }),
      expect.any(String),
    );
  });

  it("does not emit open event if already open", () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(3, 60_000, logger as never);

    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime"); // opens

    const callsBefore = logger.info.mock.calls.length;

    cb.recordFailure("stage:runtime"); // already open — no additional open event
    const callsAfter = logger.info.mock.calls.length;

    expect(callsAfter).toBe(callsBefore);
  });

  it("recordSuccess clears the failure window", () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(3, 60_000, logger as never);

    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime");
    expect(cb.isOpen("stage:runtime")).toBe(true);

    cb.recordSuccess("stage:runtime");
    expect(cb.isOpen("stage:runtime")).toBe(false);
  });

  it("recordSuccess emits reset event when was open", () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(3, 60_000, logger as never);

    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime");

    cb.recordSuccess("stage:runtime");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "circuit_breaker_reset", key: "stage:runtime" }),
      expect.any(String),
    );
  });

  it("recordSuccess does NOT emit reset event when was closed", () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(3, 60_000, logger as never);

    cb.recordSuccess("stage:runtime"); // no prior failures
    const resetCalls = logger.info.mock.calls.filter(
      (c) => c[0]?.event === "circuit_breaker_reset",
    );
    expect(resetCalls).toHaveLength(0);
  });

  it("prunes entries outside the sliding window", () => {
    const logger = makeLogger();
    const windowMs = 10_000;
    const cb = new CircuitBreaker(3, windowMs, logger as never);

    cb.recordFailure("stage:runtime");
    cb.recordFailure("stage:runtime");

    // Advance time past the window
    vi.advanceTimersByTime(windowMs + 1);

    // Add one new failure — the two old ones should be pruned
    cb.recordFailure("stage:runtime");

    expect(cb.isOpen("stage:runtime")).toBe(false); // only 1 failure within window
  });

  it("keys are isolated from each other", () => {
    const logger = makeLogger();
    const cb = new CircuitBreaker(3, 60_000, logger as never);

    for (let i = 0; i < 5; i++) {
      cb.recordFailure("stageA:runtime");
    }

    expect(cb.isOpen("stageA:runtime")).toBe(true);
    expect(cb.isOpen("stageB:runtime")).toBe(false);
  });
});
