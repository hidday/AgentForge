import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("logger", () => {
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    vi.doUnmock("pino");
    vi.doUnmock("../../src/config/env.js");
    vi.resetModules();
  });

  it("configures pino with the env log level and a pino-pretty transport outside production", async () => {
    process.env.NODE_ENV = "development";
    const pinoMock = vi.fn(() => ({ level: "debug" }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "debug" } }));
    vi.resetModules();

    const { logger } = await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock).toHaveBeenCalledWith({
      level: "debug",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
    expect(logger).toEqual({ level: "debug" });
  });

  it("omits the pretty transport in production", async () => {
    process.env.NODE_ENV = "production";
    const pinoMock = vi.fn(() => ({ level: "warn" }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "warn" } }));
    vi.resetModules();

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock).toHaveBeenCalledWith({
      level: "warn",
      transport: undefined,
    });
  });

  it("uses the configured LOG_LEVEL value for the level option", async () => {
    process.env.NODE_ENV = "development";
    const pinoMock = vi.fn(() => ({ level: "trace" }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "trace" } }));
    vi.resetModules();

    await import("../../src/utils/logger.js");

    const [callArgs] = pinoMock.mock.calls[0] as [{ level: string }];
    expect(callArgs.level).toBe("trace");
  });
});
