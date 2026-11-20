import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("utils/logger", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../../src/config/env.js");
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  it("exposes a pino logger whose level matches env.LOG_LEVEL", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { LOG_LEVEL: "warn" },
    }));
    process.env.NODE_ENV = "development";

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("warn");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("builds a logger (with pretty transport) outside production", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { LOG_LEVEL: "info" },
    }));
    process.env.NODE_ENV = "test";

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger).toBeDefined();
    expect(logger.level).toBe("info");
  });

  it("builds a logger without the pretty transport in production", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { LOG_LEVEL: "error" },
    }));
    process.env.NODE_ENV = "production";

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger).toBeDefined();
    expect(logger.level).toBe("error");
  });

  it("logging through the instance does not throw", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { LOG_LEVEL: "info" },
    }));
    process.env.NODE_ENV = "production";

    const { logger } = await import("../../src/utils/logger.js");

    expect(() => logger.info({ foo: "bar" }, "hello")).not.toThrow();
  });
});
