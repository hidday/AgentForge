import { describe, it, expect, vi, afterEach } from "vitest";

function mockGeneratedClients() {
  const PrismaClientMock = vi.fn().mockImplementation((config: unknown) => ({
    config,
    $disconnect: vi.fn().mockResolvedValue(undefined),
  }));
  const PrismaPgMock = vi.fn().mockImplementation((config: unknown) => ({ config }));
  vi.doMock("../../src/generated/prisma/client.js", () => ({ PrismaClient: PrismaClientMock }));
  vi.doMock("@prisma/adapter-pg", () => ({ PrismaPg: PrismaPgMock }));
  return { PrismaClientMock, PrismaPgMock };
}

describe("prisma singleton", () => {
  afterEach(() => {
    vi.doUnmock("../../src/generated/prisma/client.js");
    vi.doUnmock("@prisma/adapter-pg");
    vi.resetModules();
    delete process.env.LOG_LEVEL;
  });

  it("caches a single PrismaClient instance across calls, built with the pg adapter", async () => {
    const { PrismaClientMock, PrismaPgMock } = mockGeneratedClients();
    vi.resetModules();

    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    expect(PrismaPgMock).toHaveBeenCalledTimes(1);
    const config = PrismaClientMock.mock.calls[0][0] as { log: string[]; adapter: unknown };
    expect(config.log).toEqual(["warn", "error"]);
    expect(config.adapter).toBe(PrismaPgMock.mock.results[0].value);
  });

  it("enables verbose query logging when LOG_LEVEL is debug", async () => {
    process.env.LOG_LEVEL = "debug";
    const { PrismaClientMock } = mockGeneratedClients();
    vi.resetModules();

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    const config = PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(config.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("enables verbose query logging when LOG_LEVEL is trace", async () => {
    process.env.LOG_LEVEL = "trace";
    const { PrismaClientMock } = mockGeneratedClients();
    vi.resetModules();

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    const config = PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(config.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("disconnects the cached client and allows a fresh client to be created afterwards", async () => {
    const { PrismaClientMock } = mockGeneratedClients();
    vi.resetModules();

    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient() as { $disconnect: () => Promise<void> };
    await disconnectPrisma();
    expect(first.$disconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("is a no-op when no client has been created yet", async () => {
    mockGeneratedClients();
    vi.resetModules();

    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });
});
