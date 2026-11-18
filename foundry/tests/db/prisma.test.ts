import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const MockPrismaClient = vi.fn().mockImplementation((args: unknown) => ({
  __args: args,
  $disconnect: mockDisconnect,
}));
const MockPrismaPg = vi.fn().mockImplementation((args: unknown) => ({ __pgArgs: args }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: MockPrismaClient,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: MockPrismaPg,
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDisconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("constructs a PrismaClient with a PrismaPg adapter on first call", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();

    expect(MockPrismaPg).toHaveBeenCalledTimes(1);
    expect(MockPrismaClient).toHaveBeenCalledTimes(1);
    expect(client).toBeDefined();
  });

  it("memoizes the client: subsequent calls reuse the same instance without reconstructing it", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).toBe(first);
    expect(MockPrismaClient).toHaveBeenCalledTimes(1);
    expect(MockPrismaPg).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma calls $disconnect and clears the memoized instance", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(MockPrismaClient).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a no-op when no client has been constructed yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it("enables verbose Prisma logging when LOG_LEVEL is debug or trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));
    vi.resetModules();

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(MockPrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );

    vi.doUnmock("../../src/config/env.js");
  });

  it("uses minimal logging (warn/error only) for non-debug LOG_LEVEL values", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(MockPrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });
});
