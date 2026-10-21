import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoMock = vi.fn(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("pino", () => ({
  default: pinoMock,
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

  it("configures pino with the pino-pretty transport outside production", async () => {
    process.env.NODE_ENV = "test";
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "info" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith({
      level: "info",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
  });

  it("omits the transport in production", async () => {
    process.env.NODE_ENV = "production";
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "warn" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith({
      level: "warn",
      transport: undefined,
    });
  });

  it("uses the configured LOG_LEVEL for the pino level", async () => {
    process.env.NODE_ENV = "test";
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "debug" } }));

    await import("../../src/utils/logger.js");

    const call = pinoMock.mock.calls[0]?.[0] as { level: string };
    expect(call.level).toBe("debug");
  });
});
