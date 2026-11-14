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

  it("builds a pino logger using the configured LOG_LEVEL outside production", async () => {
    process.env.NODE_ENV = "test";
    const { logger } = await import("../../src/utils/logger.js");
    const { env } = await import("../../src/config/env.js");

    expect(logger.level).toBe(env.LOG_LEVEL);
    expect(typeof logger.info).toBe("function");
  });

  it("builds a logger without the pretty transport in production", async () => {
    process.env.NODE_ENV = "production";
    const { logger } = await import("../../src/utils/logger.js");

    expect(typeof logger.info).toBe("function");
    expect(logger.level).toBeDefined();
  });
});
