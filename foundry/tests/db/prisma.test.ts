import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const MockPrismaClient = vi.fn().mockImplementation(() => ({ $disconnect: mockDisconnect }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: MockPrismaClient,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn().mockImplementation((opts: unknown) => ({ opts })),
}));

vi.mock("../../src/config/env.js", () => ({
  env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
}));

describe("prisma client singleton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("creates a single PrismaClient instance across repeated calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(MockPrismaClient).toHaveBeenCalledTimes(1);
  });

  it("uses only warn/error log levels when LOG_LEVEL is info", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(MockPrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("enables verbose query logging when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(MockPrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("disconnectPrisma disconnects and clears the singleton so the next call recreates it", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    getPrismaClient();
    await disconnectPrisma();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    getPrismaClient();
    expect(MockPrismaClient).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a no-op when no client was ever created", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
