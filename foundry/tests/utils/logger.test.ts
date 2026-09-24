import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoMock = vi.fn().mockReturnValue({ __isMockLogger: true });

vi.mock("pino", () => ({ default: pinoMock }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.doUnmock("../../src/config/env.js");
  });

  it("constructs pino with the configured LOG_LEVEL", async () => {
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "debug" } }));

    const { logger } = await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith(expect.objectContaining({ level: "debug" }));
    expect(logger).toEqual({ __isMockLogger: true });
  });

  it("enables the pino-pretty transport outside production", async () => {
    process.env.NODE_ENV = "development";
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "info" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: { target: "pino-pretty", options: { colorize: true } },
      }),
    );
  });

  it("disables the transport in production", async () => {
    process.env.NODE_ENV = "production";
    vi.doMock("../../src/config/env.js", () => ({ env: { LOG_LEVEL: "info" } }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith(expect.objectContaining({ transport: undefined }));
  });
});
