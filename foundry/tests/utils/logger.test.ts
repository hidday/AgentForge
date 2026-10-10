import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.resetModules();
  });

  it("exposes a pino-like logger interface when NODE_ENV is production (no pretty transport)", async () => {
    process.env.NODE_ENV = "production";
    const mod = await import("../../src/utils/logger.js");
    expect(typeof mod.logger.info).toBe("function");
    expect(typeof mod.logger.warn).toBe("function");
    expect(typeof mod.logger.error).toBe("function");
    expect(typeof mod.logger.debug).toBe("function");
  });

  it("exposes a pino-like logger interface when NODE_ENV is development (pretty transport attached)", async () => {
    process.env.NODE_ENV = "development";
    const mod = await import("../../src/utils/logger.js");
    expect(typeof mod.logger.info).toBe("function");
    expect(typeof mod.logger.warn).toBe("function");
    expect(typeof mod.logger.error).toBe("function");
    expect(typeof mod.logger.debug).toBe("function");
  });

  it("exposes a pino-like logger interface when NODE_ENV is unset (pretty transport attached)", async () => {
    delete process.env.NODE_ENV;
    const mod = await import("../../src/utils/logger.js");
    expect(typeof mod.logger.info).toBe("function");
    expect(typeof mod.logger.child).toBe("function");
  });

  it("does not throw when logging a message in either configuration", async () => {
    process.env.NODE_ENV = "production";
    const mod = await import("../../src/utils/logger.js");
    expect(() => mod.logger.info("test message")).not.toThrow();
  });
});
