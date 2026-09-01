import { describe, it, expect } from "vitest";
import { logger } from "../../src/utils/logger.js";
import { env } from "../../src/config/env.js";

describe("logger", () => {
  it("is a pino logger instance exposing the standard level methods", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("is configured with the level from env.LOG_LEVEL", () => {
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("supports creating a child logger with bound bindings", () => {
    const child = logger.child({ component: "test" });
    expect(typeof child.info).toBe("function");
    expect(child.level).toBe(logger.level);
  });

  it("does not throw when logging at each configured level", () => {
    expect(() => logger.info("logger test info message")).not.toThrow();
    expect(() => logger.warn("logger test warn message")).not.toThrow();
    expect(() => logger.debug("logger test debug message")).not.toThrow();
  });
});
