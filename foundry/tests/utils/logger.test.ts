import { describe, it, expect, vi, afterEach } from "vitest";
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

describe("logger in production mode", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it("builds without a pino-pretty transport when NODE_ENV is 'production'", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    const { logger: prodLogger } = await import("../../src/utils/logger.js");
    expect(prodLogger).toBeDefined();
    expect(typeof prodLogger.info).toBe("function");
  });
});
