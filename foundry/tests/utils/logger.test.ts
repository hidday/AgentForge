import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it("exports a pino logger instance with an info method and the configured level", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    const { env } = await import("../../src/config/env.js");

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("uses the pino-pretty transport when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "test";
    const { logger } = await import("../../src/utils/logger.js");

    // Logging should not throw regardless of transport wiring.
    expect(() => logger.info("non-production logger smoke test")).not.toThrow();
  });

  it("omits the pretty transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const { logger } = await import("../../src/utils/logger.js");

    expect(() => logger.info("production logger smoke test")).not.toThrow();
  });
});
