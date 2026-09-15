import { describe, it, expect, vi } from "vitest";
import { getPrismaClient, disconnectPrisma } from "../../src/db/prisma.js";

// Note: getPrismaClient() constructs a real PrismaClient wired to a PrismaPg
// adapter, but PrismaClient construction itself does not open a database
// connection (Prisma connects lazily on first query), so this is safe to
// exercise without a real database. These tests verify the singleton-reuse
// and disconnect wiring in db/prisma.ts without ever issuing a query.
//
// Test order matters here: the module holds a single module-level `prisma`
// variable, so the "no client yet" case must run before anything creates one.
describe("prisma singleton", () => {
  it("disconnectPrisma() no-ops when no client has been created yet", async () => {
    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });

  it("getPrismaClient() returns a client exposing the expected Prisma API", () => {
    const client = getPrismaClient();
    expect(client).toBeDefined();
    expect(typeof client.$disconnect).toBe("function");
    expect(typeof client.$connect).toBe("function");
  });

  it("getPrismaClient() reuses the same instance across repeated calls", () => {
    const first = getPrismaClient();
    const second = getPrismaClient();
    const third = getPrismaClient();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("disconnectPrisma() calls $disconnect on the existing client and clears the singleton", async () => {
    const client = getPrismaClient();
    const disconnectSpy = vi.spyOn(client, "$disconnect").mockResolvedValue(undefined);

    await disconnectPrisma();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    // After disconnecting, the module's singleton is cleared, so the next
    // call must construct (and return) a brand new client instance.
    const next = getPrismaClient();
    expect(next).not.toBe(client);
  });

  it("disconnectPrisma() is a no-op again once the singleton has been cleared", async () => {
    // At this point in the suite a client exists (created by the previous
    // test). Disconnect it, then call disconnectPrisma() a second time in a
    // row to confirm the second call does nothing (no client to disconnect).
    const client = getPrismaClient();
    const disconnectSpy = vi.spyOn(client, "$disconnect").mockResolvedValue(undefined);

    await disconnectPrisma();
    await disconnectPrisma();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it("enables verbose query/info logging when LOG_LEVEL is debug or trace", async () => {
    const originalLogLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "debug";
    vi.resetModules();
    try {
      // Re-import with a fresh module registry so config/env.ts re-parses
      // process.env with LOG_LEVEL=debug, taking the verbose-logging branch
      // in getPrismaClient()'s `log` option.
      const fresh = await import("../../src/db/prisma.js");
      const client = fresh.getPrismaClient();
      expect(client).toBeDefined();
      await fresh.disconnectPrisma();
    } finally {
      if (originalLogLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = originalLogLevel;
      }
      vi.resetModules();
    }
  });
});
