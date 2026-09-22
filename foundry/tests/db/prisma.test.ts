import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation((opts: unknown) => ({
  __opts: opts,
  $disconnect: mockDisconnect,
}));
const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ __adapterOpts: opts }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

async function mockEnv(overrides: { DATABASE_URL?: string; LOG_LEVEL?: string } = {}) {
  vi.doMock("../../src/config/env.js", () => ({
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      LOG_LEVEL: "info",
      ...overrides,
    },
  }));
}

describe("db/prisma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("constructs a PrismaClient with a PrismaPg adapter built from env.DATABASE_URL", async () => {
    await mockEnv({ DATABASE_URL: "postgresql://user:pw@host:5432/mydb" });
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://user:pw@host:5432/mydb",
    });
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    expect(client).toBeDefined();
  });

  it("returns the same cached instance on repeated getPrismaClient() calls", async () => {
    await mockEnv();
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();
    const third = getPrismaClient();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    expect(PrismaPgMock).toHaveBeenCalledTimes(1);
  });

  it("enables verbose query/info/warn/error logging when LOG_LEVEL is 'debug'", async () => {
    await mockEnv({ LOG_LEVEL: "debug" });
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const constructorArgs = PrismaClientMock.mock.calls[0]?.[0] as { log: string[] };
    expect(constructorArgs.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("enables verbose logging when LOG_LEVEL is 'trace'", async () => {
    await mockEnv({ LOG_LEVEL: "trace" });
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const constructorArgs = PrismaClientMock.mock.calls[0]?.[0] as { log: string[] };
    expect(constructorArgs.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("restricts logging to warn/error when LOG_LEVEL is 'info'", async () => {
    await mockEnv({ LOG_LEVEL: "info" });
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const constructorArgs = PrismaClientMock.mock.calls[0]?.[0] as { log: string[] };
    expect(constructorArgs.log).toEqual(["warn", "error"]);
  });

  it("disconnectPrisma calls $disconnect and clears the cached instance so the next call rebuilds it", async () => {
    await mockEnv();
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a safe no-op when no client has been created yet", async () => {
    await mockEnv();
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(PrismaClientMock).not.toHaveBeenCalled();
  });
});
