import { describe, it, expect } from "vitest";
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
});
