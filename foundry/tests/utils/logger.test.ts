import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
    vi.doUnmock("pino");
  });

  it("configures the log level from env.LOG_LEVEL", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    const { env } = await import("../../src/config/env.js");

    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("is a usable pino logger exposing the standard logging methods", async () => {
    const { logger } = await import("../../src/utils/logger.js");

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    // Should not throw when actually logging.
    expect(() => logger.info({ test: true }, "logger smoke test")).not.toThrow();
  });

  it("configures a pino-pretty transport outside of production", async () => {
    process.env.NODE_ENV = "development";
    const pinoOptionsCapture: unknown[] = [];
    vi.doMock("pino", () => {
      const fn = vi.fn((options: unknown) => {
        pinoOptionsCapture.push(options);
        return { level: (options as { level: string }).level } as unknown;
      });
      return { default: fn };
    });

    await import("../../src/utils/logger.js");

    expect(pinoOptionsCapture).toHaveLength(1);
    const options = pinoOptionsCapture[0] as { transport?: { target: string } };
    expect(options.transport).toEqual({
      target: "pino-pretty",
      options: { colorize: true },
    });
  });

  it("does not configure a transport in production (NODE_ENV=production)", async () => {
    process.env.NODE_ENV = "production";
    const pinoOptionsCapture: unknown[] = [];
    vi.doMock("pino", () => {
      const fn = vi.fn((options: unknown) => {
        pinoOptionsCapture.push(options);
        return { level: (options as { level: string }).level } as unknown;
      });
      return { default: fn };
    });

    await import("../../src/utils/logger.js");

    expect(pinoOptionsCapture).toHaveLength(1);
    const options = pinoOptionsCapture[0] as { transport?: unknown };
    expect(options.transport).toBeUndefined();
  });
});
