import { describe, it, expect, afterEach, vi } from "vitest";
import { logger } from "../../src/utils/logger.js";
import { env } from "../../src/config/env.js";

describe("logger", () => {
  it("is configured with the log level from env", () => {
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

  describe("transport selection by NODE_ENV", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      vi.resetModules();
    });

    it("constructs a logger with no transport (undefined branch) when NODE_ENV is production", async () => {
      process.env.NODE_ENV = "production";
      vi.resetModules();

      const mod = await import("../../src/utils/logger.js");

      expect(mod.logger.level).toBe(env.LOG_LEVEL);
      expect(() => mod.logger.info("production mode smoke test")).not.toThrow();
    });
  });
});
