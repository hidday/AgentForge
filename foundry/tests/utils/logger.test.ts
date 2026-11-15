import { describe, it, expect, vi, afterEach } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.doUnmock("pino");
    vi.resetModules();
  });

  it("configures a pretty-printed transport outside production", async () => {
    process.env.NODE_ENV = "development";
    const pinoMock = vi.fn((config: unknown) => ({ config, info: vi.fn() }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.resetModules();

    const { logger } = await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const config = pinoMock.mock.calls[0][0] as { transport?: unknown; level?: string };
    expect(config.transport).toEqual({ target: "pino-pretty", options: { colorize: true } });
    expect(logger).toBeDefined();
  });

  it("omits the transport in production", async () => {
    process.env.NODE_ENV = "production";
    const pinoMock = vi.fn((config: unknown) => ({ config, info: vi.fn() }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.resetModules();

    await import("../../src/utils/logger.js");

    const config = pinoMock.mock.calls[0][0] as { transport?: unknown };
    expect(config.transport).toBeUndefined();
  });

  it("sets the log level from the parsed env", async () => {
    process.env.NODE_ENV = "development";
    const pinoMock = vi.fn((config: unknown) => ({ config, info: vi.fn() }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.resetModules();

    await import("../../src/utils/logger.js");
    const { env } = await import("../../src/config/env.js");

    const config = pinoMock.mock.calls[0][0] as { level?: string };
    expect(config.level).toBe(env.LOG_LEVEL);
  });
});
