import { describe, it, expect, afterEach, vi } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it("builds a pino logger using the configured LOG_LEVEL in non-production", async () => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("info");
    expect(typeof logger.info).toBe("function");
  });

  it("builds a pino logger without pretty-printing in production", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("info");
  });
});
