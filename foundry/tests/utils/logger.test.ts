import { describe, it, expect } from "vitest";
import { logger } from "../../src/utils/logger.js";
import { env } from "../../src/config/env.js";

describe("logger", () => {
  it("is configured with the log level from env.LOG_LEVEL", () => {
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("exposes the standard pino leveled logging methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("does not throw when logging a message with structured fields", () => {
    expect(() => logger.info({ scope: "test" }, "logger smoke test")).not.toThrow();
  });
});
