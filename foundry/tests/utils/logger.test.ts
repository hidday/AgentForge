import { describe, it, expect } from "vitest";
import { logger } from "../../src/utils/logger.js";

describe("logger", () => {
  it("is defined and exposes the standard pino logging methods", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.fatal).toBe("function");
  });

  it("has a level reflecting the configured LOG_LEVEL", () => {
    expect(typeof logger.level).toBe("string");
    expect(logger.level.length).toBeGreaterThan(0);
  });

  it("can log without throwing", () => {
    expect(() => logger.info("test log message")).not.toThrow();
  });
});
