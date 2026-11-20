import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrismaConstructor = vi.fn();
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockPrismaPgConstructor = vi.fn();

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: class MockPrismaClient {
    $disconnect: typeof mockDisconnect;
    constructor(opts: unknown) {
      mockPrismaConstructor(opts);
      this.$disconnect = mockDisconnect;
    }
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class MockPrismaPg {
    constructor(opts: unknown) {
      mockPrismaPgConstructor(opts);
    }
  },
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    mockPrismaConstructor.mockClear();
    mockDisconnect.mockClear();
    mockPrismaPgConstructor.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("getPrismaClient() constructs a PrismaClient with a PrismaPg adapter on first call", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();

    expect(client).toBeDefined();
    expect(mockPrismaConstructor).toHaveBeenCalledTimes(1);
    expect(mockPrismaPgConstructor).toHaveBeenCalledTimes(1);
    const [[opts]] = mockPrismaConstructor.mock.calls;
    expect(opts).toHaveProperty("adapter");
    expect(opts).toHaveProperty("log");
  });

  it("getPrismaClient() returns the same singleton on subsequent calls without reconstructing", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).toBe(first);
    expect(mockPrismaConstructor).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma() calls $disconnect() on the instance and clears the singleton", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(mockPrismaConstructor).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma() is a no-op when no client has been constructed yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it("sets verbose log levels when LOG_LEVEL is debug or trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const [[opts]] = mockPrismaConstructor.mock.calls as [[{ log: string[] }]];
    expect(opts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("sets minimal log levels when LOG_LEVEL is info", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const [[opts]] = mockPrismaConstructor.mock.calls as [[{ log: string[] }]];
    expect(opts.log).toEqual(["warn", "error"]);
  });
});
