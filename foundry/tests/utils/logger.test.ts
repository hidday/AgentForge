import { describe, it, expect } from "vitest";
import { logger } from "../../src/utils/logger.js";

describe("logger", () => {
  it("is a usable pino logger exposing the standard level methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("logs at the configured level without throwing", () => {
    expect(() => logger.info({ test: true }, "logger smoke test")).not.toThrow();
  });
});
