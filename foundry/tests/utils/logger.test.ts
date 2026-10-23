import { describe, it, expect } from "vitest";
import { logger } from "../../src/utils/logger.js";
import { env } from "../../src/config/env.js";

describe("logger", () => {
  it("exposes the standard pino logging methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.fatal).toBe("function");
  });

  it("is configured with the level from env.LOG_LEVEL", () => {
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("can log a message without throwing", () => {
    expect(() => logger.info({ test: true }, "logger smoke test")).not.toThrow();
  });
});
