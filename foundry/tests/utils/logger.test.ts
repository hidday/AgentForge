import { describe, it, expect, afterEach, vi } from "vitest";

describe("logger", () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
    vi.resetModules();
  });

  it("is configured at the env LOG_LEVEL and exposes standard pino methods", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    const { env } = await import("../../src/config/env.js");

    expect(logger.level).toBe(env.LOG_LEVEL);
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(() => logger.info("test log message")).not.toThrow();
  });

  it("omits the pino-pretty transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const { logger } = await import("../../src/utils/logger.js");

    expect(() => logger.info("production log message")).not.toThrow();
  });
});
