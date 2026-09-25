import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoMock = vi.fn(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("pino", () => ({
  default: (...args: unknown[]) => pinoMock(...args),
}));

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    pinoMock.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  it("configures pino with a pino-pretty transport when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "debug";

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const config = pinoMock.mock.calls[0]?.[0] as {
      level: string;
      transport?: { target: string; options: { colorize: boolean } };
    };
    expect(config.level).toBe("debug");
    expect(config.transport).toEqual({ target: "pino-pretty", options: { colorize: true } });
  });

  it("configures pino with no transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "warn";

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const config = pinoMock.mock.calls[0]?.[0] as { level: string; transport?: unknown };
    expect(config.level).toBe("warn");
    expect(config.transport).toBeUndefined();
  });

  it("exports the logger instance created by pino", async () => {
    process.env.NODE_ENV = "test";

    const mod = await import("../../src/utils/logger.js");

    expect(mod.logger).toBeDefined();
    expect(typeof mod.logger.info).toBe("function");
  });
});
