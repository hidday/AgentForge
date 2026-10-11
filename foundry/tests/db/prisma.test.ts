import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => {
  return {
    PrismaPg: vi.fn().mockImplementation((opts: unknown) => ({ __kind: "PrismaPg", opts })),
  };
});

vi.mock("../../src/generated/prisma/client.js", () => {
  return {
    PrismaClient: vi.fn().mockImplementation((opts: unknown) => ({
      __kind: "PrismaClient",
      opts,
      $disconnect: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("db/prisma", () => {
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.resetModules();
    // The mocked PrismaClient/PrismaPg constructors are singletons shared across
    // this file's dynamic imports; clear call history (but keep the
    // mockImplementation set in the factories above) so each test starts clean.
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  it("constructs a PrismaClient wired to a PrismaPg adapter using env.DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const { PrismaClient } = await import("../../src/generated/prisma/client.js");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { env } = await import("../../src/config/env.js");

    const client = getPrismaClient();

    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect(PrismaPg).toHaveBeenCalledWith({ connectionString: env.DATABASE_URL });
    expect(client).toBeDefined();
  });

  it("memoizes the client: a second call returns the same instance without constructing again", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const { PrismaClient } = await import("../../src/generated/prisma/client.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).toBe(first);
    expect(PrismaClient).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma is a safe no-op when no client was ever created", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    const { PrismaClient } = await import("../../src/generated/prisma/client.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(PrismaClient).not.toHaveBeenCalled();
  });

  it("disconnectPrisma calls $disconnect and resets state so the next getPrismaClient call builds a new instance", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const { PrismaClient } = await import("../../src/generated/prisma/client.js");

    const client1 = getPrismaClient() as unknown as { $disconnect: ReturnType<typeof vi.fn> };
    await disconnectPrisma();

    expect(client1.$disconnect).toHaveBeenCalledTimes(1);

    const client2 = getPrismaClient();

    expect(PrismaClient).toHaveBeenCalledTimes(2);
    expect(client2).not.toBe(client1);
  });

  it("enables full query/info/warn/error logging when LOG_LEVEL is debug", async () => {
    process.env.LOG_LEVEL = "debug";
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const { PrismaClient } = await import("../../src/generated/prisma/client.js");

    getPrismaClient();

    expect(PrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("enables full query/info/warn/error logging when LOG_LEVEL is trace", async () => {
    process.env.LOG_LEVEL = "trace";
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const { PrismaClient } = await import("../../src/generated/prisma/client.js");

    getPrismaClient();

    expect(PrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("restricts logging to warn/error when LOG_LEVEL is info (default)", async () => {
    process.env.LOG_LEVEL = "info";
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const { PrismaClient } = await import("../../src/generated/prisma/client.js");

    getPrismaClient();

    expect(PrismaClient).toHaveBeenCalledWith(expect.objectContaining({ log: ["warn", "error"] }));
  });
});
