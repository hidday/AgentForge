import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoFactory = vi.fn(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock("pino", () => ({
  default: (...args: unknown[]) => pinoFactory(...args),
}));

vi.mock("../../src/config/env.js", () => ({
  env: { LOG_LEVEL: "debug" },
}));

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    pinoFactory.mockClear();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("configures pino with the env LOG_LEVEL and a pretty transport outside production", async () => {
    process.env.NODE_ENV = "test";
    await import("../../src/utils/logger.js");

    expect(pinoFactory).toHaveBeenCalledTimes(1);
    const options = pinoFactory.mock.calls[0]![0] as { level: string; transport?: unknown };
    expect(options.level).toBe("debug");
    expect(options.transport).toMatchObject({
      target: "pino-pretty",
      options: { colorize: true },
    });
  });

  it("omits the pretty transport in production", async () => {
    process.env.NODE_ENV = "production";
    await import("../../src/utils/logger.js");

    expect(pinoFactory).toHaveBeenCalledTimes(1);
    const options = pinoFactory.mock.calls[0]![0] as { transport?: unknown };
    expect(options.transport).toBeUndefined();
  });
});
