import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.doUnmock("pino");
    vi.doUnmock("../../src/config/env.js");
    vi.resetModules();
  });

  it("configures pino without a pretty transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const pinoMock = vi.fn(() => ({ info: vi.fn() }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "warn" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock).toHaveBeenCalledWith({
      level: "warn",
      transport: undefined,
    });
  });

  it("configures pino with the pino-pretty transport when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "development";
    const pinoMock = vi.fn(() => ({ info: vi.fn() }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "info" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock).toHaveBeenCalledWith({
      level: "info",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
  });

  it("configures pino with the pretty transport when NODE_ENV is unset", async () => {
    delete process.env.NODE_ENV;
    const pinoMock = vi.fn(() => ({ info: vi.fn() }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "debug" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith({
      level: "debug",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
  });

  it("exports the real pino logger instance wired to the configured level (integration smoke test)", async () => {
    vi.doUnmock("pino");
    vi.doUnmock("../../src/config/env.js");
    const { logger } = await import("../../src/utils/logger.js");

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.level).toBe("string");
  });
});
