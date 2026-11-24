import { describe, it, expect, vi, afterEach } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.doUnmock("pino");
    vi.resetModules();
  });

  it("configures a pino-pretty transport outside production", async () => {
    process.env.NODE_ENV = "development";
    const pinoMock = vi.fn().mockReturnValue({});
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.resetModules();

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: { target: "pino-pretty", options: { colorize: true } },
      }),
    );
  });

  it("omits the transport in production", async () => {
    process.env.NODE_ENV = "production";
    const pinoMock = vi.fn().mockReturnValue({});
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.resetModules();

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith(expect.objectContaining({ transport: undefined }));
  });

  it("configures the logger with the env-resolved log level", async () => {
    process.env.NODE_ENV = "production";
    const pinoMock = vi.fn().mockReturnValue({});
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.resetModules();

    const { env } = await import("../../src/config/env.js");
    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith(expect.objectContaining({ level: env.LOG_LEVEL }));
  });
});
