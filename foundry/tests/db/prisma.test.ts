import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation((opts: unknown) => ({
  $disconnect: disconnectMock,
  __opts: opts,
}));
const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ __adapterOpts: opts }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    LOG_LEVEL: "info",
  },
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    PrismaPgMock.mockClear();
    disconnectMock.mockClear();
  });

  afterEach(async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await disconnectPrisma();
  });

  it("getPrismaClient constructs a PrismaClient with a PrismaPg adapter built from env.DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();

    expect(client).toBeDefined();
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
  });

  it("getPrismaClient caches the instance: a second call returns the same object without re-constructing", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).toBe(first);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("uses the non-verbose log levels when LOG_LEVEL is not debug/trace", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const opts = PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(opts.log).toEqual(["warn", "error"]);
  });

  it("disconnectPrisma calls $disconnect on the cached client and clears the singleton", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    // After disconnect, the next getPrismaClient() call must construct a fresh instance.
    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});

describe("db/prisma with debug log level", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    PrismaPgMock.mockClear();
  });

  it("uses verbose log levels when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: {
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        LOG_LEVEL: "debug",
      },
    }));

    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    getPrismaClient();

    const opts = PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(opts.log).toEqual(["query", "info", "warn", "error"]);

    await disconnectPrisma();
  });
});
