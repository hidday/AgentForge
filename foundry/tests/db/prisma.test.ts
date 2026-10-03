import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaInstances: unknown[] = [];

vi.mock("../../src/generated/prisma/client.js", () => {
  class FakePrismaClient {
    public readonly options: unknown;
    public $disconnect = vi.fn().mockResolvedValue(undefined);
    constructor(options: unknown) {
      this.options = options;
      prismaInstances.push(this);
    }
  }
  return { PrismaClient: FakePrismaClient };
});

vi.mock("@prisma/adapter-pg", () => {
  class FakePrismaPg {
    public readonly config: unknown;
    constructor(config: unknown) {
      this.config = config;
    }
  }
  return { PrismaPg: FakePrismaPg };
});

describe("prisma singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    prismaInstances.length = 0;
  });

  it("getPrismaClient() lazily constructs a PrismaClient wired to env.DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const { env } = await import("../../src/config/env.js");

    expect(prismaInstances.length).toBe(0);
    const client = getPrismaClient();
    expect(prismaInstances.length).toBe(1);
    expect(client).toBe(prismaInstances[0]);
    const options = (client as { options: { adapter: { config: { connectionString: string } } } })
      .options;
    expect(options.adapter.config.connectionString).toBe(env.DATABASE_URL);
  });

  it("returns the same cached instance on subsequent calls (singleton)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    const second = getPrismaClient();
    expect(second).toBe(first);
    expect(prismaInstances.length).toBe(1);
  });

  it("sets log to only warn/error when LOG_LEVEL is not debug/trace", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const client = getPrismaClient() as { options: { log: string[] } };
    expect(client.options.log).toEqual(["warn", "error"]);
  });

  it("disconnectPrisma() disconnects and clears the cached instance so a new one is created next", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const first = getPrismaClient() as { $disconnect: ReturnType<typeof vi.fn> };

    await disconnectPrisma();

    expect(first.$disconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(prismaInstances.length).toBe(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma() is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(prismaInstances.length).toBe(0);
  });

  it("sets log to include query/info when LOG_LEVEL is debug", async () => {
    const prevLogLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "debug";
    try {
      const { getPrismaClient } = await import("../../src/db/prisma.js");
      const client = getPrismaClient() as { options: { log: string[] } };
      expect(client.options.log).toEqual(["query", "info", "warn", "error"]);
    } finally {
      if (prevLogLevel === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = prevLogLevel;
    }
  });
});
