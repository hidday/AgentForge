import { describe, it, expect, vi, afterEach } from "vitest";

// logger.ts picks its pino transport at import time based on NODE_ENV, so
// each case stubs the env, mocks pino to capture the options, and imports a
// fresh copy of the module.

async function loadWith(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const sentinel = { kind: "fake-logger" };
  const pinoFactory = vi.fn(() => sentinel);
  vi.doMock("pino", () => ({ default: pinoFactory }));
  const mod = await import("../../src/utils/logger.js");
  const { env } = await import("../../src/config/env.js");
  return { mod, pinoFactory, sentinel, env };
}

afterEach(() => {
  vi.doUnmock("pino");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("logger transport selection", () => {
  it("uses structured JSON output (no transport) in production", async () => {
    const { mod, pinoFactory, sentinel, env } = await loadWith("production");

    expect(pinoFactory).toHaveBeenCalledTimes(1);
    expect(pinoFactory).toHaveBeenCalledWith({ level: env.LOG_LEVEL, transport: undefined });
    expect(mod.logger).toBe(sentinel);
  });

  it.each(["development", "test"])("uses pino-pretty with colour when NODE_ENV=%s", async (n) => {
    const { pinoFactory, env } = await loadWith(n);

    expect(pinoFactory).toHaveBeenCalledWith({
      level: env.LOG_LEVEL,
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
  });
});
