import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.LOG_LEVEL = originalLogLevel;
    vi.doUnmock("pino");
    vi.resetModules();
  });

  it("configures pino with env.LOG_LEVEL and the pretty transport when not in production", async () => {
    process.env.LOG_LEVEL = "debug";
    process.env.NODE_ENV = "development";

    const pinoMock = vi.fn().mockReturnValue({ level: "debug" });
    vi.doMock("pino", () => ({ default: pinoMock }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock).toHaveBeenCalledWith({
      level: "debug",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
  });

  it("omits the pretty transport when NODE_ENV is production", async () => {
    process.env.LOG_LEVEL = "warn";
    process.env.NODE_ENV = "production";

    const pinoMock = vi.fn().mockReturnValue({ level: "warn" });
    vi.doMock("pino", () => ({ default: pinoMock }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock).toHaveBeenCalledWith({
      level: "warn",
      transport: undefined,
    });
  });

  it("exports the instance returned by pino as `logger`", async () => {
    process.env.LOG_LEVEL = "info";
    process.env.NODE_ENV = "test";

    const fakeInstance = { level: "info", marker: "fake-logger-instance" };
    const pinoMock = vi.fn().mockReturnValue(fakeInstance);
    vi.doMock("pino", () => ({ default: pinoMock }));

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger).toBe(fakeInstance);
  });
});
