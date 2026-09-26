import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.$disconnect = disconnectMock;
});
const PrismaPgMock = vi.fn().mockImplementation(function (this: Record<string, unknown>, opts: unknown) {
  this.opts = opts;
});

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

  afterEach(() => {
    vi.doUnmock("../../src/config/env.js");
  });

  it("constructs a single PrismaClient instance and reuses it across calls (singleton)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("constructs the PrismaPg adapter with the DATABASE_URL connection string", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledTimes(1);
    const adapterOpts = PrismaPgMock.mock.calls[0]![0] as { connectionString: string };
    expect(adapterOpts.connectionString).toBe(process.env.DATABASE_URL);
  });

  it("disconnectPrisma calls $disconnect and resets the singleton so the next getPrismaClient() constructs a new client", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);

    await disconnectPrisma();
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a no-op (does not call $disconnect) when no client has ever been constructed", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(PrismaClientMock).not.toHaveBeenCalled();
  });

  it("requests verbose query logging when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    const opts = PrismaClientMock.mock.calls[0]![0] as { log: string[] };
    expect(opts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("requests only warn/error logging when LOG_LEVEL is info (the default)", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
    }));

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    const opts = PrismaClientMock.mock.calls[0]![0] as { log: string[] };
    expect(opts.log).toEqual(["warn", "error"]);
  });
});
