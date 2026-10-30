import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
const prismaClientCtor = vi.fn().mockImplementation(() => ({
  $disconnect: disconnectMock,
}));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: prismaClientCtor,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn().mockImplementation((opts: unknown) => ({ opts })),
}));

describe("prisma client singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    prismaClientCtor.mockClear();
    disconnectMock.mockClear();
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
  });

  it("memoizes the client across repeated calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const a = getPrismaClient();
    const b = getPrismaClient();
    expect(a).toBe(b);
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("uses only warn/error log levels by default", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    const config = prismaClientCtor.mock.calls[0]![0] as { log: string[] };
    expect(config.log).toEqual(["warn", "error"]);
  });

  it("disconnects the memoized client and allows a fresh one to be created afterward", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    await disconnectPrisma();
    expect(disconnectMock).toHaveBeenCalledOnce();

    const second = getPrismaClient();
    expect(second).not.toBe(first);
    expect(prismaClientCtor).toHaveBeenCalledTimes(2);
  });

  it("uses verbose log levels when LOG_LEVEL is debug", async () => {
    process.env.LOG_LEVEL = "debug";
    vi.resetModules();
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    const config = prismaClientCtor.mock.calls[0]![0] as { log: string[] };
    expect(config.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
