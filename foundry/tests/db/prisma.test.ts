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

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    PrismaPgMock.mockClear();
    disconnect.mockClear();
  });

  it("getPrismaClient() constructs a PrismaClient with a pg adapter bound to DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledWith({ connectionString: expect.any(String) });
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("getPrismaClient() memoizes the client across calls (singleton)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma() disconnects and clears the singleton so the next call re-creates it", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    getPrismaClient();
    await disconnectPrisma();

    expect(disconnect).toHaveBeenCalledTimes(1);

    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma() is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
