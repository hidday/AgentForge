import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaClientCtor = vi.fn();
const disconnectMock = vi.fn().mockResolvedValue(undefined);
const adapterCtor = vi.fn();

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: class {
    $disconnect = disconnectMock;
    constructor(opts: unknown) {
      prismaClientCtor(opts);
    }
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(opts: unknown) {
      adapterCtor(opts);
    }
  },
}));

describe("getPrismaClient / disconnectPrisma", () => {
  beforeEach(() => {
    vi.resetModules();
    prismaClientCtor.mockClear();
    disconnectMock.mockClear();
    adapterCtor.mockClear();
  });

  it("constructs a PrismaClient wired to env.DATABASE_URL via the pg adapter", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(adapterCtor).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("returns the same singleton instance on repeated calls", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const a = getPrismaClient();
    const b = getPrismaClient();

    expect(a).toBe(b);
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("enables verbose query/info/warn/error logging when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const opts = prismaClientCtor.mock.calls[0][0] as { log: string[] };
    expect(opts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("enables verbose logging for LOG_LEVEL trace too", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "trace" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const opts = prismaClientCtor.mock.calls[0][0] as { log: string[] };
    expect(opts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("only logs warn/error for non-debug, non-trace log levels", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const opts = prismaClientCtor.mock.calls[0][0] as { log: string[] };
    expect(opts.log).toEqual(["warn", "error"]);
  });

  it("disconnects and resets the singleton so the next call constructs a fresh client", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
    }));
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    getPrismaClient();
    expect(prismaClientCtor).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when disconnectPrisma is called before any client was created", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
    }));
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
