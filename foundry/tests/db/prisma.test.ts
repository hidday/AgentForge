import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/generated/prisma/client.js", () => {
  class MockPrismaClient {
    public opts: unknown;
    public $disconnect = vi.fn().mockResolvedValue(undefined);
    constructor(opts: unknown) {
      this.opts = opts;
    }
  }
  return { PrismaClient: MockPrismaClient };
});

vi.mock("@prisma/adapter-pg", () => {
  class MockPrismaPg {
    public opts: unknown;
    constructor(opts: unknown) {
      this.opts = opts;
    }
  }
  return { PrismaPg: MockPrismaPg };
});

interface MockClientShape {
  opts: {
    adapter: { opts: { connectionString: string } };
    log: string[];
  };
  $disconnect: ReturnType<typeof vi.fn>;
}

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("creates a PrismaClient wired to a PrismaPg adapter using env.DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const { env } = await import("../../src/config/env.js");

    const client = getPrismaClient() as unknown as MockClientShape;

    expect(client.opts.adapter.opts.connectionString).toBe(env.DATABASE_URL);
  });

  it("uses warn/error-only logging when LOG_LEVEL is not debug or trace", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient() as unknown as MockClientShape;

    expect(client.opts.log).toEqual(["warn", "error"]);
  });

  it("enables full query logging when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/config/env.js")>(
        "../../src/config/env.js",
      );
      return { ...actual, env: { ...actual.env, LOG_LEVEL: "debug" } };
    });

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const client = getPrismaClient() as unknown as MockClientShape;

    expect(client.opts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("enables full query logging when LOG_LEVEL is trace", async () => {
    vi.doMock("../../src/config/env.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/config/env.js")>(
        "../../src/config/env.js",
      );
      return { ...actual, env: { ...actual.env, LOG_LEVEL: "trace" } };
    });

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const client = getPrismaClient() as unknown as MockClientShape;

    expect(client.opts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("returns the same instance on subsequent calls (singleton)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).toBe(first);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });

  it("disconnectPrisma disconnects the existing client and clears the singleton so the next call creates a new one", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const client = getPrismaClient() as unknown as MockClientShape;
    await disconnectPrisma();

    expect(client.$disconnect).toHaveBeenCalledTimes(1);

    const next = getPrismaClient() as unknown as MockClientShape;
    expect(next).not.toBe(client);
  });
});
