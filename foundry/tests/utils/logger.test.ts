import { describe, it, expect, vi, afterEach } from "vitest";

describe("logger", () => {
  afterEach(() => {
    vi.doUnmock("../../src/config/env.js");
    vi.resetModules();
  });

  it("exposes the standard pino logging methods", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("sets the logger level from env.LOG_LEVEL", async () => {
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "warn" } }));

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("warn");
  });

  it("respects a different LOG_LEVEL value across module reloads", async () => {
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "debug" } }));

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("debug");
  });

  it("builds without throwing when NODE_ENV=production (no pretty-print transport)", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "info" } }));
      const { logger } = await import("../../src/utils/logger.js");
      expect(logger.level).toBe("info");
      expect(typeof logger.info).toBe("function");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
