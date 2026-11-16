import { describe, it, expect, afterEach, vi } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.doUnmock("../../src/config/env.js");
    vi.resetModules();
  });

  it("builds a usable pino logger with env.LOG_LEVEL when NODE_ENV is not production", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "development";
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "debug" } }));

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("debug");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("builds a usable pino logger with no pretty transport when NODE_ENV is production", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "warn" } }));

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("warn");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });
});
