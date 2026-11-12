import { describe, it, expect } from "vitest";
import { logger } from "../../src/utils/logger.js";

describe("logger", () => {
  it("is a pino-like logger instance exposing the standard level methods", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("does not throw when logging at a few levels", () => {
    expect(() => logger.info("notification service test smoke log")).not.toThrow();
    expect(() => logger.debug({ some: "context" }, "debug smoke log")).not.toThrow();
  });
});
