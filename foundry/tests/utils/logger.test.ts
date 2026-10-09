import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("utils/logger", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("pino");
    vi.doUnmock("../../src/config/env.js");
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  it("configures pino with the env LOG_LEVEL and a pino-pretty transport outside production", async () => {
    process.env.NODE_ENV = "test";
    const pinoMock = vi.fn().mockReturnValue({ fakeLogger: true });
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "debug" } }));

    const { logger } = await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock).toHaveBeenCalledWith({
      level: "debug",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
    expect(logger).toEqual({ fakeLogger: true });
  });

  it("omits the transport option in production", async () => {
    process.env.NODE_ENV = "production";
    const pinoMock = vi.fn().mockReturnValue({ fakeLogger: true });
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "warn" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith({
      level: "warn",
      transport: undefined,
    });
  });
});
