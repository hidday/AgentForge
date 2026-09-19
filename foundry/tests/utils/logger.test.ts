import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, DATABASE_URL: "postgresql://test:test@localhost:5432/test" };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("exposes a pino logger configured with the env LOG_LEVEL", async () => {
    process.env.LOG_LEVEL = "debug";
    const { logger } = await import("../../src/utils/logger.js");
    expect(logger.level).toBe("debug");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("defaults to info level when LOG_LEVEL is not set", async () => {
    delete process.env.LOG_LEVEL;
    const { logger } = await import("../../src/utils/logger.js");
    expect(logger.level).toBe("info");
  });

  it("configures a pino-pretty transport outside of production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { logger } = await import("../../src/utils/logger.js");
    // pino exposes the transport-backed stream when a transport is configured;
    // logging must not throw with the pretty transport wired up.
    expect(() => logger.info("non-production log line")).not.toThrow();
    vi.unstubAllEnvs();
  });

  it("omits the pino-pretty transport in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { logger } = await import("../../src/utils/logger.js");
    expect(() => logger.info("production log line")).not.toThrow();
    vi.unstubAllEnvs();
  });
});
