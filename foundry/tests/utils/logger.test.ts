import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const infoMock = vi.fn();
const fakeLoggerInstance = {
  info: infoMock,
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
};
const pinoMock = vi.fn().mockReturnValue(fakeLoggerInstance);

vi.mock("pino", () => ({
  default: pinoMock,
}));

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    pinoMock.mockClear();
    infoMock.mockClear();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("constructs pino with the configured LOG_LEVEL and a pino-pretty transport outside production", async () => {
    process.env.NODE_ENV = "test";
    const { env } = await import("../../src/config/env.js");
    const { logger } = await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const options = pinoMock.mock.calls[0][0] as { level: string; transport?: unknown };
    expect(options.level).toBe(env.LOG_LEVEL);
    expect(options.transport).toEqual({
      target: "pino-pretty",
      options: { colorize: true },
    });
    expect(logger).toBe(fakeLoggerInstance);
  });

  it("omits the pino-pretty transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    await import("../../src/config/env.js");
    await import("../../src/utils/logger.js");

    const options = pinoMock.mock.calls[0][0] as { transport?: unknown };
    expect(options.transport).toBeUndefined();
  });

  it("delegates .info() calls to the underlying pino instance", async () => {
    process.env.NODE_ENV = "test";
    await import("../../src/config/env.js");
    const { logger } = await import("../../src/utils/logger.js");

    logger.info({ runId: "run-1" }, "hello from AgentForge");

    expect(infoMock).toHaveBeenCalledWith({ runId: "run-1" }, "hello from AgentForge");
  });
});
