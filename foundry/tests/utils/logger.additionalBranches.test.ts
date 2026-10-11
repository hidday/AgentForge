import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

describe("logger — pino-pretty transport branch", () => {
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    vi.resetModules();
    vi.doUnmock("pino");
  });

  it("passes transport: undefined to pino() when NODE_ENV is 'production'", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.NODE_ENV = "production";
    vi.resetModules();

    const pinoMock = vi.fn().mockReturnValue({ info: vi.fn() });
    vi.doMock("pino", () => ({ default: pinoMock }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock.mock.calls[0]![0]).toMatchObject({ transport: undefined });
  });

  it("passes a pino-pretty transport config to pino() when NODE_ENV is not 'production'", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.NODE_ENV = "development";
    vi.resetModules();

    const pinoMock = vi.fn().mockReturnValue({ info: vi.fn() });
    vi.doMock("pino", () => ({ default: pinoMock }));

    await import("../../src/utils/logger.js");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    expect(pinoMock.mock.calls[0]![0]).toMatchObject({
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
  });
});
