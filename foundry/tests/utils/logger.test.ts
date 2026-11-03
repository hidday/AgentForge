import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoMock = vi.fn().mockReturnValue({ fakeLoggerInstance: true });

vi.mock("pino", () => ({
  default: pinoMock,
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

async function importLoggerModule() {
  return import("../../src/utils/logger.js");
}

describe("utils/logger", () => {
  beforeEach(() => {
    vi.resetModules();
    pinoMock.mockClear();
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    vi.doUnmock("../../src/config/env.js");
  });

  it("configures pino with the LOG_LEVEL from env", async () => {
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "warn" } }));
    process.env.NODE_ENV = "test";
    await importLoggerModule();

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const options = pinoMock.mock.calls[0]![0] as { level: string };
    expect(options.level).toBe("warn");
  });

  it("enables pino-pretty transport outside production", async () => {
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "info" } }));
    process.env.NODE_ENV = "development";
    await importLoggerModule();

    const options = pinoMock.mock.calls[0]![0] as {
      transport?: { target: string; options: { colorize: boolean } };
    };
    expect(options.transport).toEqual({ target: "pino-pretty", options: { colorize: true } });
  });

  it("disables the pretty transport in production", async () => {
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "error" } }));
    process.env.NODE_ENV = "production";
    await importLoggerModule();

    const options = pinoMock.mock.calls[0]![0] as { transport?: unknown };
    expect(options.transport).toBeUndefined();
  });

  it("exports the pino instance as `logger`", async () => {
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "info" } }));
    process.env.NODE_ENV = "test";
    const { logger } = await importLoggerModule();
    expect(logger).toEqual({ fakeLoggerInstance: true });
  });
});
