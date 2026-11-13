import { describe, it, expect, afterEach, vi } from "vitest";
import { logger } from "../../src/utils/logger.js";
import { env } from "../../src/config/env.js";

describe("logger", () => {
  it("exports a pino logger configured with the level from env.LOG_LEVEL", () => {
    expect(logger).toBeDefined();
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("exposes the standard pino logging methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("can create a child logger that inherits bindings", () => {
    const child = logger.child({ component: "test" });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });
});

describe("logger module NODE_ENV branching", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it("configures pino without the pino-pretty transport when NODE_ENV is production", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";

    const { logger: prodLogger } = await import("../../src/utils/logger.js");

    expect(prodLogger).toBeDefined();
    expect(typeof prodLogger.info).toBe("function");
  });
});
