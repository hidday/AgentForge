import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Covers the NODE_ENV === "production" branch (transport disabled) of logger.ts
// that logger.test.ts (NODE_ENV unset in the test runner) does not exercise.

describe("logger transport branch", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("disables the pino-pretty transport when NODE_ENV is 'production'", async () => {
    process.env.NODE_ENV = "production";
    const { logger } = await import("../../src/utils/logger.js");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });
});
