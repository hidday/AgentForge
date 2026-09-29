import { describe, it, expect, vi, beforeEach } from "vitest";

const envMock = vi.hoisted(() => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    LOG_LEVEL: "info" as string,
  },
}));

const prismaClientCtor = vi.hoisted(() => vi.fn());
const prismaPgCtor = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: class {
    $disconnect = disconnectMock;
    constructor(...args: unknown[]) {
      prismaClientCtor(...args);
    }
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(...args: unknown[]) {
      prismaPgCtor(...args);
    }
  },
}));

vi.mock("../../src/config/env.js", () => ({
  env: envMock.env,
}));

describe("prisma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    envMock.env.LOG_LEVEL = "info";
  });

  it("constructs the client with the pg adapter using env.DATABASE_URL and a minimal log level by default", async () => {
    envMock.env.LOG_LEVEL = "info";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(prismaPgCtor).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
    const [options] = prismaClientCtor.mock.calls[0] as [{ log: string[]; adapter: unknown }];
    expect(options.log).toEqual(["warn", "error"]);
    expect(options.adapter).toBeInstanceOf(Object);
  });

  it("uses the verbose log level list when LOG_LEVEL is debug or trace", async () => {
    envMock.env.LOG_LEVEL = "debug";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const [options] = prismaClientCtor.mock.calls[0] as [{ log: string[] }];
    expect(options.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("uses the verbose log level list for trace as well", async () => {
    envMock.env.LOG_LEVEL = "trace";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const [options] = prismaClientCtor.mock.calls[0] as [{ log: string[] }];
    expect(options.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("returns the same cached instance on repeated calls (singleton)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma calls $disconnect and clears the cache so a new client is built next time", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(prismaClientCtor).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a no-op when no client was ever created", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
