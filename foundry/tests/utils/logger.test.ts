import { describe, it, expect, vi, afterEach } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  vi.doUnmock("pino");
  vi.doUnmock("../../src/config/env.js");
  vi.resetModules();
});

describe("logger", () => {
  it("builds the logger with env.LOG_LEVEL and a pretty transport outside production", async () => {
    process.env.NODE_ENV = "development";
    const pinoMock = vi.fn((opts: unknown) => ({ __opts: opts }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "debug" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const [opts] = pinoMock.mock.calls[0] as [{ level: string; transport?: unknown }];
    expect(opts.level).toBe("debug");
    expect(opts.transport).toEqual({
      target: "pino-pretty",
      options: { colorize: true },
    });
  });

  it("omits the transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const pinoMock = vi.fn((opts: unknown) => ({ __opts: opts }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "warn" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const [opts] = pinoMock.mock.calls[0] as [{ level: string; transport?: unknown }];
    expect(opts.level).toBe("warn");
    expect(opts.transport).toBeUndefined();
  });

  it("exports a real, usable pino logger instance at the configured level when unmocked", async () => {
    process.env.NODE_ENV = "production";
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "error" } }));

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("error");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });
});
