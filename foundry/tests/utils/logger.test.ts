import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("logger factory", () => {
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

  it("configures pino with env.LOG_LEVEL and a pino-pretty transport outside production", async () => {
    const pinoMock = vi.fn(() => ({ level: "debug" }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "debug" } }));
    process.env.NODE_ENV = "development";

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const options = pinoMock.mock.calls[0]?.[0] as {
      level: string;
      transport?: { target: string; options: { colorize: boolean } };
    };
    expect(options.level).toBe("debug");
    expect(options.transport).toEqual({ target: "pino-pretty", options: { colorize: true } });
  });

  it("omits the pino-pretty transport option when NODE_ENV is 'production'", async () => {
    const pinoMock = vi.fn(() => ({ level: "warn" }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "warn" } }));
    process.env.NODE_ENV = "production";

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const options = pinoMock.mock.calls[0]?.[0] as {
      level: string;
      transport?: unknown;
    };
    expect(options.level).toBe("warn");
    expect(options.transport).toBeUndefined();
  });

  it("uses whatever LOG_LEVEL the env module provides (e.g. 'trace')", async () => {
    const pinoMock = vi.fn(() => ({ level: "trace" }));
    vi.doMock("pino", () => ({ default: pinoMock }));
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "trace" } }));
    process.env.NODE_ENV = "development";

    await import("../../src/utils/logger.js");

    const options = pinoMock.mock.calls[0]?.[0] as { level: string };
    expect(options.level).toBe("trace");
  });
});
