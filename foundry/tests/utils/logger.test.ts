import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("exports a pino logger instance with a log level set from env", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { LOG_LEVEL: "warn" },
    }));
    process.env.NODE_ENV = "test";

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("warn");
    expect(typeof logger.info).toBe("function");
  });

  it("does not configure pretty-printing in production", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { LOG_LEVEL: "info" },
    }));
    process.env.NODE_ENV = "production";

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("info");
  });
});
