import { describe, it, expect, vi, afterEach } from "vitest";
import { getPrismaClient, disconnectPrisma } from "../../src/db/prisma.js";

describe("prisma client singleton", () => {
  afterEach(async () => {
    await disconnectPrisma();
  });

  it("returns the same client instance on repeated calls (lazy singleton)", () => {
    const first = getPrismaClient();
    const second = getPrismaClient();
    expect(second).toBe(first);
  });

  it("disconnectPrisma tears down the client so a later call creates a fresh instance", async () => {
    const first = getPrismaClient();
    await disconnectPrisma();
    const second = getPrismaClient();
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a safe no-op when no client has been created yet", async () => {
    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });

  it("enables query/info/warn/error logging when LOG_LEVEL is 'debug' or 'trace' (vs. the default warn/error-only)", async () => {
    const original = { ...process.env };
    try {
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      process.env.LOG_LEVEL = "trace";
      vi.resetModules();

      const mod = await import("../../src/db/prisma.js");
      // Constructing the client with the debug/trace log array must not throw;
      // this exercises the branch of the log-level ternary that the default
      // test env (LOG_LEVEL=info) never reaches.
      expect(() => mod.getPrismaClient()).not.toThrow();
      await mod.disconnectPrisma();
    } finally {
      process.env = original;
      vi.resetModules();
    }
  });
});
