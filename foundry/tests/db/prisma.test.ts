import { describe, it, expect, vi, afterEach } from "vitest";

describe("prisma", () => {
  afterEach(() => {
    vi.doUnmock("../../src/generated/prisma/client.js");
    vi.doUnmock("@prisma/adapter-pg");
    vi.doUnmock("../../src/config/env.js");
    vi.resetModules();
  });

  function setupMocks(logLevel: string) {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const PrismaClientMock = vi.fn().mockImplementation((opts: unknown) => ({
      $disconnect: disconnect,
      __opts: opts,
    }));
    const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ __pgOpts: opts }));

    vi.doMock("../../src/generated/prisma/client.js", () => ({
      PrismaClient: PrismaClientMock,
    }));
    vi.doMock("@prisma/adapter-pg", () => ({ PrismaPg: PrismaPgMock }));
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: logLevel },
    }));

    return { PrismaClientMock, PrismaPgMock, disconnect };
  }

  it("creates a PrismaClient with full query logging when LOG_LEVEL is debug", async () => {
    const { PrismaClientMock, PrismaPgMock } = setupMocks("debug");
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("creates a PrismaClient with full query logging when LOG_LEVEL is trace", async () => {
    const { PrismaClientMock } = setupMocks("trace");
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("creates a PrismaClient with warn/error-only logging for other log levels", async () => {
    const { PrismaClientMock } = setupMocks("info");
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("returns the same client instance on subsequent calls (singleton reuse)", async () => {
    const { PrismaClientMock } = setupMocks("info");
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma disconnects the existing client and clears the singleton", async () => {
    const { disconnect, PrismaClientMock } = setupMocks("info");
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    getPrismaClient();
    await disconnectPrisma();

    expect(disconnect).toHaveBeenCalledTimes(1);

    // Clearing the singleton means the next call creates a brand new client.
    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a no-op when no client has ever been created", async () => {
    const { disconnect } = setupMocks("info");
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
