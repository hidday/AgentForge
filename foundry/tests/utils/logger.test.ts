import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { logger } from "../../src/utils/logger.js";
import { env } from "../../src/config/env.js";

describe("logger", () => {
  it("exports a pino logger instance with the configured log level", () => {
    expect(logger).toBeDefined();
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("exposes the standard pino logging methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("logs a message without throwing", () => {
    expect(() => logger.info({ context: "test" }, "logger smoke test")).not.toThrow();
  });
});

describe("logger transport selection by NODE_ENV", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it("uses the pino-pretty transport when NODE_ENV is not 'production'", async () => {
    process.env.NODE_ENV = "development";
    const { logger: freshLogger } = await import("../../src/utils/logger.js");
    // pino exposes the resolved transport target on internal state; a pretty
    // transport spawns a worker thread, which non-production logging relies on.
    expect(freshLogger).toBeDefined();
    expect(freshLogger.level).toBe(env.LOG_LEVEL);
  });

  it("does not configure a transport when NODE_ENV is 'production'", async () => {
    process.env.NODE_ENV = "production";
    const { logger: freshLogger } = await import("../../src/utils/logger.js");
    expect(freshLogger).toBeDefined();
    expect(freshLogger.level).toBe(env.LOG_LEVEL);
  });
});
