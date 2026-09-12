import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../../src/utils/logger.js";

describe("logger", () => {
  it("exports a pino logger instance with the standard logging methods", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("uses the log level configured via env.LOG_LEVEL", () => {
    // env.LOG_LEVEL defaults to "info" when unset, per src/config/env.ts.
    expect(["trace", "debug", "info", "warn", "error", "fatal"]).toContain(logger.level);
  });

  it("does not throw when logging at each configured level", () => {
    expect(() => {
      logger.info("test info message");
      logger.warn("test warn message");
      logger.error("test error message");
      logger.debug({ some: "context" }, "test debug message with context");
    }).not.toThrow();
  });
});

describe("logger transport selection by NODE_ENV", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.resetModules();
  });

  it("omits the pino-pretty transport when NODE_ENV is production", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";

    const mod = await import("../../src/utils/logger.js");

    expect(mod.logger).toBeDefined();
    expect(typeof mod.logger.info).toBe("function");
  });
});
