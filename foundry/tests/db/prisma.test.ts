import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/generated/prisma/client.js", () => {
  class PrismaClient {
    $disconnect = vi.fn().mockResolvedValue(undefined);
    constructor(_opts: unknown) {}
  }
  return { PrismaClient };
});

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(_opts: unknown) {}
  },
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getPrismaClient returns the same instance on repeated calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const a = getPrismaClient();
    const b = getPrismaClient();
    expect(a).toBe(b);
  });

  it("disconnectPrisma calls $disconnect on the existing client", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const client = getPrismaClient() as unknown as { $disconnect: ReturnType<typeof vi.fn> };

    await disconnectPrisma();

    expect(client.$disconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma is a safe no-op when no client was ever created", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });

  it("constructs a new client instance after disconnecting", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    await disconnectPrisma();
    const second = getPrismaClient();

    expect(second).not.toBe(first);
  });

  describe("log level branch", () => {
    const originalLogLevel = process.env.LOG_LEVEL;

    afterEach(() => {
      if (originalLogLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = originalLogLevel;
      }
    });

    it("still returns a working client when LOG_LEVEL is debug (verbose logging branch)", async () => {
      process.env.LOG_LEVEL = "debug";
      const { getPrismaClient } = await import("../../src/db/prisma.js");
      const client = getPrismaClient();
      expect(client).toBeDefined();
    });
  });
});
