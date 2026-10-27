import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const prismaClientInstances: { adapter: unknown; log: unknown; $disconnect: ReturnType<typeof vi.fn> }[] = [];

vi.mock("../../src/generated/prisma/client.js", () => {
  class PrismaClient {
    adapter: unknown;
    log: unknown;
    $disconnect = vi.fn().mockResolvedValue(undefined);
    constructor(opts: { adapter: unknown; log: unknown }) {
      this.adapter = opts.adapter;
      this.log = opts.log;
      prismaClientInstances.push(this as never);
    }
  }
  return { PrismaClient };
});

vi.mock("@prisma/adapter-pg", () => {
  class PrismaPg {
    connectionString: unknown;
    constructor(opts: { connectionString: string }) {
      this.connectionString = opts.connectionString;
    }
  }
  return { PrismaPg };
});

vi.mock("../../src/config/env.js", () => ({
  env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
}));

describe("prisma singleton factory", () => {
  beforeEach(() => {
    prismaClientInstances.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("getPrismaClient() returns the exact same instance on repeated calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const a = getPrismaClient();
    const b = getPrismaClient();
    expect(a).toBe(b);
    expect(prismaClientInstances).toHaveLength(1);
  });

  it("disconnectPrisma() calls $disconnect on the existing client and clears the singleton", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const first = await getPrismaClient();
    await disconnectPrisma();

    expect(prismaClientInstances).toHaveLength(1);
    expect(prismaClientInstances[0]!.$disconnect).toHaveBeenCalledTimes(1);

    // A subsequent call constructs a fresh instance rather than reusing the old one.
    const second = getPrismaClient();
    expect(second).not.toBe(first);
    expect(prismaClientInstances).toHaveLength(2);
  });

  it("disconnectPrisma() is a safe no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(prismaClientInstances).toHaveLength(0);
  });
});
