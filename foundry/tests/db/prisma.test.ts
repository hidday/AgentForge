import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation((opts: unknown) => ({
  $disconnect: mockDisconnect,
  __opts: opts,
}));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn().mockImplementation((opts: unknown) => ({ __pgOpts: opts })),
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    mockDisconnect.mockClear();
  });

  it("reuses the same PrismaClient instance across repeated calls (singleton)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma disconnects the client and clears the singleton", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(second).not.toBe(first);
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a safe no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
