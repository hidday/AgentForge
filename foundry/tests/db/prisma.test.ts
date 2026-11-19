import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaInstances: { disconnect: ReturnType<typeof vi.fn> }[] = [];

vi.mock("../../src/generated/prisma/client.js", () => {
  class FakePrismaClient {
    disconnect = vi.fn().mockResolvedValue(undefined);
    $disconnect = this.disconnect;
    constructor(public opts: unknown) {
      prismaInstances.push(this);
    }
  }
  return { PrismaClient: FakePrismaClient };
});

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class FakePrismaPg {
    constructor(public opts: unknown) {}
  },
}));

describe("db/prisma singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    prismaInstances.length = 0;
  });

  it("creates a single PrismaClient instance across repeated getPrismaClient() calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(prismaInstances).toHaveLength(1);
  });

  it("disconnectPrisma() disconnects the client and clears the singleton so the next call creates a new one", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();

    await disconnectPrisma();

    expect(first.$disconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(second).not.toBe(first);
    expect(prismaInstances).toHaveLength(2);
  });

  it("disconnectPrisma() is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(prismaInstances).toHaveLength(0);
  });
});
