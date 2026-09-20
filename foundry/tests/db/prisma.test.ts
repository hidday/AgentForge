import { describe, it, expect, vi, afterEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
let prismaClientCtor: ReturnType<typeof vi.fn>;
let prismaPgCtor: ReturnType<typeof vi.fn>;

const TEST_DATABASE_URL = "postgresql://user:pass@host:5432/db";

function setupMocks(logLevel: string) {
  vi.resetModules();
  disconnectMock.mockClear();

  prismaClientCtor = vi.fn().mockImplementation((opts: unknown) => ({
    $disconnect: disconnectMock,
    __opts: opts,
  }));
  prismaPgCtor = vi.fn().mockImplementation((opts: unknown) => ({ __opts: opts }));

  vi.doMock("../../src/generated/prisma/client.js", () => ({ PrismaClient: prismaClientCtor }));
  vi.doMock("@prisma/adapter-pg", () => ({ PrismaPg: prismaPgCtor }));
  vi.doMock("../../src/config/env.js", () => ({
    env: { DATABASE_URL: TEST_DATABASE_URL, LOG_LEVEL: logLevel },
  }));
}

afterEach(() => {
  vi.doUnmock("../../src/generated/prisma/client.js");
  vi.doUnmock("@prisma/adapter-pg");
  vi.doUnmock("../../src/config/env.js");
  vi.resetModules();
});

describe("getPrismaClient", () => {
  it("constructs a PrismaClient wired to a PrismaPg adapter built from env.DATABASE_URL", async () => {
    setupMocks("info");
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();

    expect(prismaPgCtor).toHaveBeenCalledTimes(1);
    expect(prismaPgCtor).toHaveBeenCalledWith({ connectionString: TEST_DATABASE_URL });
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);

    const [opts] = prismaClientCtor.mock.calls[0] as [{ adapter: unknown }];
    expect(opts.adapter).toBe(prismaPgCtor.mock.results[0]?.value);
    expect(client).toBeDefined();
  });

  it("returns the same singleton instance on repeated calls, constructing PrismaClient only once", async () => {
    setupMocks("info");
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
    expect(prismaPgCtor).toHaveBeenCalledTimes(1);
  });

  it("enables verbose query/info/warn/error logs when LOG_LEVEL is debug", async () => {
    setupMocks("debug");
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const [opts] = prismaClientCtor.mock.calls[0] as [{ log: string[] }];
    expect(opts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("enables verbose query/info/warn/error logs when LOG_LEVEL is trace", async () => {
    setupMocks("trace");
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const [opts] = prismaClientCtor.mock.calls[0] as [{ log: string[] }];
    expect(opts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("falls back to warn/error-only logs for non-debug, non-trace LOG_LEVEL values", async () => {
    setupMocks("info");
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const [opts] = prismaClientCtor.mock.calls[0] as [{ log: string[] }];
    expect(opts.log).toEqual(["warn", "error"]);
  });
});

describe("disconnectPrisma", () => {
  it("disconnects the existing client and resets the singleton so the next call constructs a new instance", async () => {
    setupMocks("info");
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();

    expect(second).not.toBe(first);
    expect(prismaClientCtor).toHaveBeenCalledTimes(2);
  });

  it("is a no-op that resolves without error when no client has been created yet", async () => {
    setupMocks("info");
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();

    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
