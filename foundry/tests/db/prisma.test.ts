import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEnv = { LOG_LEVEL: "info", DATABASE_URL: "postgresql://test:test@localhost:5432/test" };

const mockPrismaClientInstances: unknown[] = [];
const PrismaClientCtor = vi.fn().mockImplementation((config: unknown) => {
  const instance = { __config: config, $disconnect: vi.fn().mockResolvedValue(undefined) };
  mockPrismaClientInstances.push(instance);
  return instance;
});

const PrismaPgCtor = vi.fn().mockImplementation((config: unknown) => ({ __adapterConfig: config }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientCtor,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgCtor,
}));

vi.mock("../../src/config/env.js", () => ({
  env: mockEnv,
}));

describe("prisma singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientCtor.mockClear();
    PrismaPgCtor.mockClear();
    mockPrismaClientInstances.length = 0;
    mockEnv.LOG_LEVEL = "info";
  });

  it("constructs a PrismaClient with a PrismaPg adapter using the configured connection string", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();

    expect(PrismaPgCtor).toHaveBeenCalledWith({ connectionString: mockEnv.DATABASE_URL });
    expect(PrismaClientCtor).toHaveBeenCalledTimes(1);
    expect(client).toBe(mockPrismaClientInstances[0]);
  });

  it("uses verbose logging when LOG_LEVEL is debug", async () => {
    mockEnv.LOG_LEVEL = "debug";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("uses verbose logging when LOG_LEVEL is trace", async () => {
    mockEnv.LOG_LEVEL = "trace";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("uses minimal logging for other log levels (e.g. info)", async () => {
    mockEnv.LOG_LEVEL = "info";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(expect.objectContaining({ log: ["warn", "error"] }));
  });

  it("returns the same cached instance on repeated calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("disconnects and clears the singleton, and a subsequent call constructs a new instance", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect((first as { $disconnect: ReturnType<typeof vi.fn> }).$disconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(PrismaClientCtor).not.toHaveBeenCalled();
  });
});
