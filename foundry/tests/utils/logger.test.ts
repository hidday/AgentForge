import { describe, it, expect, vi, afterEach } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.doUnmock("pino");
    vi.doUnmock("../../src/config/env.js");
    vi.resetModules();
  });

  it("configures pino with the pino-pretty transport and env.LOG_LEVEL when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    const pinoMock = vi.fn(() => ({ fakeLogger: true }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "info" } }));

    const mod = await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith({
      level: "info",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
    expect(mod.logger).toEqual({ fakeLogger: true });
  });

  it("omits the transport when NODE_ENV is production, and uses the configured log level", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const pinoMock = vi.fn(() => ({ fakeLogger: true }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "warn" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith({
      level: "warn",
      transport: undefined,
    });
  });
});
