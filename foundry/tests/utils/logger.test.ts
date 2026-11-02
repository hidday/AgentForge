import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../../src/utils/logger.js";
import { env } from "../../src/config/env.js";

describe("logger", () => {
  it("is configured at the level specified by env.LOG_LEVEL", () => {
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("exposes the standard pino logging methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });
});

describe("logger transport selection", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.doUnmock("pino");
    vi.resetModules();
  });

  it("omits the pino-pretty transport when NODE_ENV=production", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    const pinoFactory = vi.fn().mockReturnValue({});
    vi.doMock("pino", () => ({ default: pinoFactory }));

    await import("../../src/utils/logger.js");

    expect(pinoFactory).toHaveBeenCalledWith(
      expect.objectContaining({ transport: undefined }),
    );
  });

  it("enables the pino-pretty transport outside production", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "development";
    const pinoFactory = vi.fn().mockReturnValue({});
    vi.doMock("pino", () => ({ default: pinoFactory }));

    await import("../../src/utils/logger.js");

    expect(pinoFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: { target: "pino-pretty", options: { colorize: true } },
      }),
    );
  });
});
