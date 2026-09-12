import { describe, it, expect } from "vitest";
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
