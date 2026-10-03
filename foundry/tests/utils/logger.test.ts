import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.doUnmock("pino");
  });

  it("configures pino with env.LOG_LEVEL and the pino-pretty transport outside production", async () => {
    process.env.NODE_ENV = "development";
    const pinoMock = vi.fn(() => ({ level: "info" }));
    vi.doMock("pino", () => ({ default: pinoMock }));

    const { env } = await import("../../src/config/env.js");
    const { logger } = await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock).toHaveBeenCalledWith({
      level: env.LOG_LEVEL,
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
    expect(logger).toBeDefined();
  });

  it("omits the pretty transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const pinoMock = vi.fn(() => ({ level: "info" }));
    vi.doMock("pino", () => ({ default: pinoMock }));

    const { env } = await import("../../src/config/env.js");
    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith({
      level: env.LOG_LEVEL,
      transport: undefined,
    });
  });

  it("exposes a real pino logger instance with the expected level (no mocks)", async () => {
    vi.doUnmock("pino");
    const { env } = await import("../../src/config/env.js");
    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe(env.LOG_LEVEL);
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });
});
