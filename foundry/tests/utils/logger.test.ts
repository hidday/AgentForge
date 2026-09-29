import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoMock = vi.hoisted(() => vi.fn(() => ({ level: "mock-logger" })));
const envMock = vi.hoisted(() => ({ env: { LOG_LEVEL: "info" as string } }));

vi.mock("pino", () => ({ default: pinoMock }));
vi.mock("../../src/config/env.js", () => ({ env: envMock.env }));

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    envMock.env.LOG_LEVEL = "info";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("builds pino with the level from env.LOG_LEVEL", async () => {
    envMock.env.LOG_LEVEL = "warn";
    process.env.NODE_ENV = "development";

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const [options] = pinoMock.mock.calls[0] as [{ level: string }];
    expect(options.level).toBe("warn");
  });

  it("includes the pino-pretty transport when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "development";

    await import("../../src/utils/logger.js");

    const [options] = pinoMock.mock.calls[0] as [{ transport?: unknown }];
    expect(options.transport).toEqual({
      target: "pino-pretty",
      options: { colorize: true },
    });
  });

  it("omits the transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";

    await import("../../src/utils/logger.js");

    const [options] = pinoMock.mock.calls[0] as [{ transport?: unknown }];
    expect(options.transport).toBeUndefined();
  });
});
