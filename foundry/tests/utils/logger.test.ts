import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// pino stores its output stream under a private Symbol("pino.stream"). When a
// `transport` option is configured, that stream is a `ThreadStream` (backed by
// a worker thread running pino-pretty); with no transport it is a plain
// `SonicBoom` destination. Reading this symbol lets us assert which branch of
// logger.ts's NODE_ENV ternary actually ran, not just that import succeeded.
function streamConstructorName(logger: object): string | undefined {
  const streamSymbol = Object.getOwnPropertySymbols(logger).find(
    (s) => s.toString() === "Symbol(pino.stream)",
  );
  if (!streamSymbol) return undefined;
  const stream = (logger as Record<symbol, unknown>)[streamSymbol];
  return (stream as { constructor: { name: string } } | undefined)?.constructor.name;
}

describe("logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("../../src/config/env.js");
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("sets the pino level from env.LOG_LEVEL ('warn')", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { LOG_LEVEL: "warn" },
    }));
    process.env.NODE_ENV = "test";

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("warn");
  });

  it("sets the pino level from env.LOG_LEVEL ('debug') when it differs", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { LOG_LEVEL: "debug" },
    }));
    process.env.NODE_ENV = "test";

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("debug");
  });

  it("wires up the pino-pretty transport (ThreadStream) when NODE_ENV is not 'production'", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { LOG_LEVEL: "info" },
    }));
    process.env.NODE_ENV = "development";

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("info");
    expect(streamConstructorName(logger)).toBe("ThreadStream");
  });

  it("uses a plain destination (SonicBoom, no transport) when NODE_ENV is 'production'", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { LOG_LEVEL: "info" },
    }));
    process.env.NODE_ENV = "production";

    const { logger } = await import("../../src/utils/logger.js");

    expect(logger.level).toBe("info");
    expect(streamConstructorName(logger)).toBe("SonicBoom");
  });
});
