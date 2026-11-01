import { describe, it, expect, vi, beforeEach } from "vitest";

const { disconnectMock, prismaClientCtor, prismaPgCtor } = vi.hoisted(() => {
  const disconnectMock = vi.fn().mockResolvedValue(undefined);
  return {
    disconnectMock,
    prismaClientCtor: vi.fn().mockImplementation(() => ({ $disconnect: disconnectMock })),
    prismaPgCtor: vi.fn().mockImplementation((opts: unknown) => ({ adapter: true, opts })),
  };
});

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: prismaClientCtor,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: prismaPgCtor,
}));

vi.mock("../../src/config/env.js", () => ({
  env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
}));

import { getPrismaClient, disconnectPrisma } from "../../src/db/prisma.js";

describe("getPrismaClient", () => {
  beforeEach(async () => {
    await disconnectPrisma();
    prismaClientCtor.mockClear();
    prismaPgCtor.mockClear();
    disconnectMock.mockClear();
  });

  it("constructs a PrismaClient with a pg adapter wired to DATABASE_URL", () => {
    getPrismaClient();

    expect(prismaPgCtor).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
    const [options] = prismaClientCtor.mock.calls[0]!;
    expect(options.log).toEqual(["warn", "error"]);
  });

  it("caches the client across repeated calls instead of recreating it", () => {
    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).toBe(first);
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
  });
});

describe("getPrismaClient log level branching", () => {
  it("enables query/info/warn/error logging when LOG_LEVEL is debug or trace", async () => {
    vi.resetModules();
    prismaClientCtor.mockClear();
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "trace" },
    }));

    const { getPrismaClient: freshGetPrismaClient } = await import("../../src/db/prisma.js");
    freshGetPrismaClient();

    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
    const [options] = prismaClientCtor.mock.calls[0]!;
    expect(options.log).toEqual(["query", "info", "warn", "error"]);

    vi.doUnmock("../../src/config/env.js");
    vi.resetModules();
  });
});

describe("disconnectPrisma", () => {
  beforeEach(async () => {
    await disconnectPrisma();
    prismaClientCtor.mockClear();
    disconnectMock.mockClear();
  });

  it("disconnects the cached client and allows a fresh one to be created afterward", async () => {
    const client = getPrismaClient();
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);

    await disconnectPrisma();
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const next = getPrismaClient();
    expect(prismaClientCtor).toHaveBeenCalledTimes(2);
    expect(next).not.toBe(client);
  });

  it("is a no-op when there is no client to disconnect", async () => {
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
