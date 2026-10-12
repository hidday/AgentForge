import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaClientCtor = vi.fn();
const disconnectMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: vi.fn().mockImplementation((options: unknown) => {
    prismaClientCtor(options);
    return { $disconnect: disconnectMock };
  }),
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn().mockImplementation((options: unknown) => ({ __adapterOptions: options })),
}));

function mockEnv(logLevel: string) {
  vi.doMock("../../src/config/env.js", () => ({
    env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: logLevel },
  }));
}

describe("prisma client", () => {
  beforeEach(() => {
    vi.resetModules();
    prismaClientCtor.mockClear();
    disconnectMock.mockClear();
  });

  it("creates a single PrismaClient instance across repeated calls", async () => {
    mockEnv("info");
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("only logs warn and error when LOG_LEVEL is info", async () => {
    mockEnv("info");
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(prismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("logs query/info/warn/error when LOG_LEVEL is debug", async () => {
    mockEnv("debug");
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(prismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("logs query/info/warn/error when LOG_LEVEL is trace", async () => {
    mockEnv("trace");
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(prismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("disconnects and allows a fresh client to be created afterward", async () => {
    mockEnv("info");
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(second).not.toBe(first);
    expect(prismaClientCtor).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a no-op when no client was ever created", async () => {
    mockEnv("info");
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
