import { describe, it, expect, afterEach, vi } from "vitest";

describe("logger", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    vi.resetModules();
  });

  it("exports a pino logger instance with info/warn/error/debug methods", async () => {
    vi.resetModules();
    const { logger } = await import("../../src/utils/logger.js");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("uses env.LOG_LEVEL as the logger's level", async () => {
    vi.resetModules();
    const { logger } = await import("../../src/utils/logger.js");
    const { env } = await import("../../src/config/env.js");
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("does not throw when NODE_ENV is 'production' (no pretty transport)", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    await expect(import("../../src/utils/logger.js")).resolves.toBeDefined();
  });

  it("does not throw when NODE_ENV is not 'production' (pretty transport enabled)", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "development";
    await expect(import("../../src/utils/logger.js")).resolves.toBeDefined();
  });
});
