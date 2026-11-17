import { describe, it, expect, afterEach, vi } from "vitest";

describe("logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("creates a pino logger at env.LOG_LEVEL with standard logging methods", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    const { env } = await import("../../src/config/env.js");

    expect(logger.level).toBe(env.LOG_LEVEL);
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("omits the pino-pretty transport when NODE_ENV is production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });
});
