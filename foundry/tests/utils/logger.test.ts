import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../../src/utils/logger.js";

describe("logger", () => {
  it("exports a pino logger instance exposing the standard logging methods", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("has a configured level string", () => {
    expect(typeof logger.level).toBe("string");
    expect(logger.level.length).toBeGreaterThan(0);
  });

  it("can log a message without throwing", () => {
    expect(() => logger.info({ test: true }, "logger smoke test")).not.toThrow();
  });
});

describe("logger — production transport branch", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it("builds without the pino-pretty transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const { logger: prodLogger } = await import("../../src/utils/logger.js");
    expect(prodLogger).toBeDefined();
    expect(() => prodLogger.info("production logger smoke test")).not.toThrow();
  });
});
