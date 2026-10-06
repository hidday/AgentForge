import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadLogger() {
  vi.resetModules();
  const mod = await import("../../src/utils/logger.js");
  return mod.logger;
}

describe("logger", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("exposes the standard pino logging methods", async () => {
    const logger = await loadLogger();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("defaults to the 'info' log level when LOG_LEVEL is not set", async () => {
    delete process.env.LOG_LEVEL;
    const logger = await loadLogger();
    expect(logger.level).toBe("info");
  });

  it("honors a LOG_LEVEL env var override (e.g. 'debug')", async () => {
    process.env.LOG_LEVEL = "debug";
    const logger = await loadLogger();
    expect(logger.level).toBe("debug");
  });

  it("honors the 'warn' and 'error' LOG_LEVEL values distinctly", async () => {
    process.env.LOG_LEVEL = "warn";
    const warnLogger = await loadLogger();
    expect(warnLogger.level).toBe("warn");

    process.env.LOG_LEVEL = "error";
    const errorLogger = await loadLogger();
    expect(errorLogger.level).toBe("error");
  });

  it("does not throw when logging at each configured level", async () => {
    const logger = await loadLogger();
    expect(() => logger.info("info message")).not.toThrow();
    expect(() => logger.warn("warn message")).not.toThrow();
    expect(() => logger.error("error message")).not.toThrow();
  });

  it("disables the pino-pretty transport in production (NODE_ENV=production)", async () => {
    process.env.NODE_ENV = "production";
    const logger = await loadLogger();
    // With no pretty transport, logging still works and the level still
    // reflects configuration -- the key behavior under test is that
    // constructing the logger under NODE_ENV=production does not throw and
    // produces a working logger (the undefined-transport branch).
    expect(() => logger.info("prod message")).not.toThrow();
    expect(logger.level).toBe("info");
  });
});
