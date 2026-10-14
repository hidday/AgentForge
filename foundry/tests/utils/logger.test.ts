import { describe, it, expect, vi, afterEach } from "vitest";
import { env } from "../../src/config/env.js";
import { logger } from "../../src/utils/logger.js";

describe("logger", () => {
  it("exports a pino logger instance exposing the standard log methods", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("is configured with the level from env.LOG_LEVEL", () => {
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("does not throw when logging at various levels", () => {
    expect(() => logger.info({ scenario: "test" }, "info message")).not.toThrow();
    expect(() => logger.warn("warn message")).not.toThrow();
    expect(() => logger.debug("debug message")).not.toThrow();
  });

  describe("under NODE_ENV=production", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      vi.resetModules();
    });

    it("builds without the pino-pretty transport", async () => {
      process.env.NODE_ENV = "production";
      vi.resetModules();

      const { logger: prodLogger } = await import("../../src/utils/logger.js");

      expect(prodLogger).toBeDefined();
      expect(typeof prodLogger.info).toBe("function");
      expect(() => prodLogger.info("prod message")).not.toThrow();
    });
  });
});
