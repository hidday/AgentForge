import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function importLogger(nodeEnv: string, logLevel: string) {
  const pinoMock = vi.fn().mockReturnValue({ level: logLevel });
  vi.doMock("pino", () => ({ default: pinoMock }));
  vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: logLevel } }));
  vi.stubEnv("NODE_ENV", nodeEnv);

  const mod = await import("../../src/utils/logger.js");
  return { mod, pinoMock };
}

describe("logger", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("configures pino with a pino-pretty transport when NODE_ENV is not 'production'", async () => {
    const { pinoMock, mod } = await importLogger("development", "debug");

    expect(pinoMock).toHaveBeenCalledWith({
      level: "debug",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
    expect(mod.logger.level).toBe("debug");
  });

  it("omits the transport (plain structured output) when NODE_ENV is 'production'", async () => {
    const { pinoMock } = await importLogger("production", "info");

    expect(pinoMock).toHaveBeenCalledWith({ level: "info", transport: undefined });
  });
});
