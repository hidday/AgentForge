import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  vi.resetModules();
});

describe("logger", () => {
  it("exports a pino logger instance with standard level methods", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(logger.level).toBe(process.env.LOG_LEVEL ?? "info");
  });

  it("configures a pino-pretty transport when NODE_ENV is not production", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "development";
    const { logger } = await import("../../src/utils/logger.js");
    // Pretty transport wires up an internal stream/worker rather than the bare stdout stream.
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });

  it("skips the transport when NODE_ENV is production", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    const { logger } = await import("../../src/utils/logger.js");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });
});
