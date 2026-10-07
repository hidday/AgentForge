import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoFactory = vi.fn((opts: unknown) => ({ __opts: opts, info: vi.fn(), error: vi.fn() }));

vi.mock("pino", () => ({
  default: (opts: unknown) => pinoFactory(opts),
}));

let mockEnv: { LOG_LEVEL: string } = { LOG_LEVEL: "info" };

vi.mock("../../src/config/env.js", () => ({
  get env() {
    return mockEnv;
  },
}));

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    pinoFactory.mockClear();
    mockEnv = { LOG_LEVEL: "info" };
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it("configures pino-pretty with colorize when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "development";
    vi.resetModules();

    const { logger } = await import("../../src/utils/logger.js");

    expect(pinoFactory).toHaveBeenCalledWith({
      level: "info",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
    expect(logger).toBeDefined();
  });

  it("omits the transport entirely when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();

    await import("../../src/utils/logger.js");

    expect(pinoFactory).toHaveBeenCalledWith({
      level: "info",
      transport: undefined,
    });
  });

  it("passes the configured LOG_LEVEL through to pino", async () => {
    process.env.NODE_ENV = "development";
    mockEnv = { LOG_LEVEL: "debug" };
    vi.resetModules();

    await import("../../src/utils/logger.js");

    expect(pinoFactory).toHaveBeenCalledWith(
      expect.objectContaining({ level: "debug" }),
    );
  });
});
