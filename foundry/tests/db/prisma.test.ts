import { describe, it, expect, vi, beforeEach } from "vitest";

// src/db/prisma.ts directly instantiates PrismaClient and PrismaPg, so we
// mock both constructors with vi.mock (there is no DI seam for this file).

const { MockPrismaClient, MockPrismaPg } = vi.hoisted(() => {
  const MockPrismaClient = vi.fn().mockImplementation(function (this: Record<string, unknown>, opts: unknown) {
    this.opts = opts;
    this.$disconnect = vi.fn().mockResolvedValue(undefined);
  });
  const MockPrismaPg = vi.fn().mockImplementation(function (this: Record<string, unknown>, opts: unknown) {
    this.opts = opts;
  });
  return { MockPrismaClient, MockPrismaPg };
});

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: MockPrismaClient,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: MockPrismaPg,
}));

import { getPrismaClient, disconnectPrisma } from "../../src/db/prisma.js";

describe("prisma client singleton", () => {
  beforeEach(() => {
    MockPrismaClient.mockClear();
    MockPrismaPg.mockClear();
  });

  it("constructs a PrismaClient (with a PrismaPg adapter) only once across repeated calls, then disconnects and allows a fresh instance afterward", async () => {
    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(MockPrismaClient).toHaveBeenCalledTimes(1);
    expect(MockPrismaPg).toHaveBeenCalledTimes(1);

    await disconnectPrisma();

    expect((first as unknown as { $disconnect: ReturnType<typeof vi.fn> }).$disconnect).toHaveBeenCalledTimes(1);

    const third = getPrismaClient();
    expect(third).not.toBe(first);
    expect(MockPrismaClient).toHaveBeenCalledTimes(2);

    // Clean up so later tests in this file see a fresh module-level singleton.
    await disconnectPrisma();
  });

  it("disconnectPrisma resolves without calling $disconnect when no client has been created yet", async () => {
    vi.resetModules();
    const fresh = await import("../../src/db/prisma.js");
    await expect(fresh.disconnectPrisma()).resolves.toBeUndefined();
  });
});
