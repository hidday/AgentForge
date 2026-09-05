import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoMock = vi.fn(() => ({ marker: "fake-pino-logger" }));

vi.mock("pino", () => ({
  default: pinoMock,
}));

vi.mock("../../src/config/env.js", () => ({
  env: { LOG_LEVEL: "debug" },
}));

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    pinoMock.mockClear();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("configures pino-pretty transport when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "development";
    const { logger } = await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith({
      level: "debug",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
    expect(logger).toEqual({ marker: "fake-pino-logger" });
  });

  it("omits the transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith({
      level: "debug",
      transport: undefined,
    });
  });
});
