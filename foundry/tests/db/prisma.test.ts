import { describe, it, expect, vi, beforeEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation(() => ({
  $disconnect: disconnectMock,
}));
const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ opts }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("getPrismaClient() lazily constructs a single PrismaClient instance and reuses it", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    expect(PrismaPgMock).toHaveBeenCalledTimes(1);
    expect(PrismaPgMock.mock.calls[0]![0]).toMatchObject({
      connectionString: expect.any(String),
    });
  });

  it("disconnectPrisma() calls $disconnect and clears the singleton so the next call rebuilds it", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(client.$disconnect).toBe(disconnectMock);

    const rebuilt = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(rebuilt).not.toBe(client);
  });

  it("disconnectPrisma() is a no-op when no client has been constructed yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
