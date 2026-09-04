import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_LOG_LEVEL = process.env.LOG_LEVEL;

function restoreLogLevel() {
  if (ORIGINAL_LOG_LEVEL === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = ORIGINAL_LOG_LEVEL;
  }
}

function mockPrismaDeps() {
  const PrismaClientMock = vi.fn().mockImplementation(function (
    this: { options: unknown; $disconnect: () => Promise<void> },
    opts: unknown,
  ) {
    this.options = opts;
    this.$disconnect = vi.fn().mockResolvedValue(undefined);
  });
  const PrismaPgMock = vi.fn().mockImplementation(function (this: { options: unknown }, opts: unknown) {
    this.options = opts;
  });

  vi.doMock("../../src/generated/prisma/client.js", () => ({ PrismaClient: PrismaClientMock }));
  vi.doMock("@prisma/adapter-pg", () => ({ PrismaPg: PrismaPgMock }));

  return { PrismaClientMock, PrismaPgMock };
}

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    restoreLogLevel();
    vi.doUnmock("../../src/generated/prisma/client.js");
    vi.doUnmock("@prisma/adapter-pg");
    vi.resetModules();
  });

  it("getPrismaClient constructs a client once and returns the same instance on subsequent calls", async () => {
    process.env.LOG_LEVEL = "info";
    const { PrismaClientMock, PrismaPgMock } = mockPrismaDeps();

    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client1 = getPrismaClient();
    const client2 = getPrismaClient();

    expect(client1).toBe(client2);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    expect(PrismaPgMock).toHaveBeenCalledTimes(1);
  });

  it("passes an adapter built from env.DATABASE_URL and warn/error logging when LOG_LEVEL is info", async () => {
    process.env.LOG_LEVEL = "info";
    const { PrismaClientMock, PrismaPgMock } = mockPrismaDeps();

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    const adapterOpts = PrismaPgMock.mock.calls[0][0] as { connectionString: string };
    expect(adapterOpts.connectionString).toBe(process.env.DATABASE_URL);

    const clientOpts = PrismaClientMock.mock.calls[0][0] as { log: string[]; adapter: unknown };
    expect(clientOpts.log).toEqual(["warn", "error"]);
    expect(clientOpts.adapter).toBeInstanceOf(PrismaPgMock);
  });

  it("enables query/info/warn/error logging when LOG_LEVEL is debug", async () => {
    process.env.LOG_LEVEL = "debug";
    const { PrismaClientMock } = mockPrismaDeps();

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    const clientOpts = PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(clientOpts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("enables query/info/warn/error logging when LOG_LEVEL is trace", async () => {
    process.env.LOG_LEVEL = "trace";
    const { PrismaClientMock } = mockPrismaDeps();

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    const clientOpts = PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(clientOpts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("disconnectPrisma disconnects the existing client and resets the singleton so the next getPrismaClient call constructs a new one", async () => {
    process.env.LOG_LEVEL = "info";
    const { PrismaClientMock } = mockPrismaDeps();

    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const client1 = getPrismaClient() as unknown as { $disconnect: ReturnType<typeof vi.fn> };
    await disconnectPrisma();

    expect(client1.$disconnect).toHaveBeenCalledTimes(1);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);

    const client2 = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(client2).not.toBe(client1);
  });

  it("disconnectPrisma is a no-op when no client has been constructed yet", async () => {
    process.env.LOG_LEVEL = "info";
    mockPrismaDeps();

    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });
});
