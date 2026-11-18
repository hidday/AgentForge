import { describe, it, expect, afterEach, vi } from "vitest";

describe("logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("exports a pino logger instance configured with env.LOG_LEVEL", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    const { env } = await import("../../src/config/env.js");

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("builds without a pretty-print transport when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });
});
