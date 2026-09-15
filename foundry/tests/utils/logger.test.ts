import { describe, it, expect, vi, afterEach } from "vitest";
import { env } from "../../src/config/env.js";
import { logger } from "../../src/utils/logger.js";

describe("logger", () => {
  it("exposes a level matching env.LOG_LEVEL", () => {
    expect(logger.level).toBe(env.LOG_LEVEL);
  });

  it("does not throw when logging", () => {
    expect(() => logger.info("x")).not.toThrow();
  });
});

describe("logger transport ternary", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
    vi.resetModules();
  });

  it("does not throw when re-imported under a non-production NODE_ENV", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    const mod = await import("../../src/utils/logger.js");
    expect(mod.logger.level).toBe(env.LOG_LEVEL);
    vi.unstubAllEnvs();
  });

  it("does not throw when re-imported under NODE_ENV=production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    const mod = await import("../../src/utils/logger.js");
    expect(mod.logger.level).toBe(env.LOG_LEVEL);
    vi.unstubAllEnvs();
  });
});
