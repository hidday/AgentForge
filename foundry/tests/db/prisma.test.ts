import { describe, it, expect, vi, beforeEach } from "vitest";

const disconnect = vi.fn().mockResolvedValue(undefined);
const PrismaClientCtor = vi.fn().mockImplementation(() => ({ $disconnect: disconnect }));
const PrismaPgCtor = vi.fn().mockImplementation((opts: unknown) => ({ opts }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientCtor,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgCtor,
}));

let mockEnv: { DATABASE_URL: string; LOG_LEVEL: string } = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  LOG_LEVEL: "info",
};

vi.mock("../../src/config/env.js", () => ({
  get env() {
    return mockEnv;
  },
}));

describe("db/prisma", () => {
  beforeEach(() => {
    disconnect.mockClear();
    PrismaClientCtor.mockClear();
    PrismaPgCtor.mockClear();
    mockEnv = { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" };
    vi.resetModules();
  });

  it("returns the same instance on repeated calls (singleton)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const a = getPrismaClient();
    const b = getPrismaClient();

    expect(a).toBe(b);
    expect(PrismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("constructs the PrismaPg adapter with the configured connection string", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaPgCtor).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
  });

  it("enables verbose query logging when LOG_LEVEL is debug", async () => {
    mockEnv = { ...mockEnv, LOG_LEVEL: "debug" };
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("enables verbose query logging when LOG_LEVEL is trace", async () => {
    mockEnv = { ...mockEnv, LOG_LEVEL: "trace" };
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("restricts logging to warn/error for non-debug log levels", async () => {
    mockEnv = { ...mockEnv, LOG_LEVEL: "info" };
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("disconnectPrisma disconnects and resets the singleton so a later call creates a new instance", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const a = getPrismaClient();
    await disconnectPrisma();

    expect(disconnect).toHaveBeenCalledTimes(1);

    const b = getPrismaClient();

    expect(b).not.toBe(a);
    expect(PrismaClientCtor).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a safe no-op when never connected", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();

    expect(disconnect).not.toHaveBeenCalled();
    expect(PrismaClientCtor).not.toHaveBeenCalled();
  });
});
