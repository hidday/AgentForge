import { describe, it, expect, vi, beforeEach } from "vitest";

const disconnect = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation(() => ({ $disconnect: disconnect }));
const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ opts }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

describe("prisma client singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    PrismaPgMock.mockClear();
    disconnect.mockClear();
  });

  it("creates a single PrismaClient instance across multiple calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("disconnects and allows a fresh client to be created afterward", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();
    expect(disconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(second).not.toBe(first);
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
