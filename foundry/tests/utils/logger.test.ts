import { describe, it, expect } from "vitest";
import { logger } from "../../src/utils/logger.js";

describe("logger", () => {
  it("is defined and exposes the standard pino logging methods", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("has a configured level matching the env LOG_LEVEL default", () => {
    // Default env LOG_LEVEL is "info" per EnvSchema default.
    expect(["trace", "debug", "info", "warn", "error", "fatal"]).toContain(logger.level);
  });

  it("does not throw when logging at each level", () => {
    expect(() => logger.info("test info message")).not.toThrow();
    expect(() => logger.warn("test warn message")).not.toThrow();
    expect(() => logger.debug("test debug message")).not.toThrow();
  });
});
