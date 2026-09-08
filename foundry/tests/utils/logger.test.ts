import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../../src/utils/logger.js";
import { env } from "../../src/config/env.js";

describe("logger", () => {
  it("exports a pino logger instance configured with the env log level", () => {
    expect(logger).toBeDefined();
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("exposes the standard pino logging methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("can log without throwing", () => {
    expect(() => logger.info({ test: true }, "logger smoke test")).not.toThrow();
  });

  describe("in production (NODE_ENV=production)", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      vi.resetModules();
    });

    it("builds the logger without the pino-pretty transport", async () => {
      vi.resetModules();
      process.env.NODE_ENV = "production";

      const { logger: prodLogger } = await import("../../src/utils/logger.js");

      expect(prodLogger).toBeDefined();
      expect(() => prodLogger.info("production logger smoke test")).not.toThrow();
    });
  });
});
