import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoMock = vi.fn(() => ({ level: "mock-logger" }));
vi.mock("pino", () => ({ default: pinoMock }));

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    pinoMock.mockClear();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("configures the pino-pretty transport when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "development";

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: { target: "pino-pretty", options: { colorize: true } },
      }),
    );
  });

  it("omits the transport when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith(expect.objectContaining({ transport: undefined }));
  });

  it("passes the configured LOG_LEVEL through to pino", async () => {
    process.env.NODE_ENV = "development";

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledWith(expect.objectContaining({ level: expect.any(String) }));
  });
});
