import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoMock = vi.hoisted(() => vi.fn(() => ({ fakeLogger: true })));

vi.mock("pino", () => ({ default: pinoMock }));
vi.mock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "debug" } }));

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    pinoMock.mockClear();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("configures pino with the env LOG_LEVEL and a colorized pino-pretty transport outside production", async () => {
    process.env.NODE_ENV = "test";
    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock).toHaveBeenCalledWith({
      level: "debug",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
  });

  it("omits the transport entirely in production", async () => {
    process.env.NODE_ENV = "production";
    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith({ level: "debug", transport: undefined });
  });
});
