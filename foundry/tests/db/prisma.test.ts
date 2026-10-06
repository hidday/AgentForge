import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => {
  return {
    PrismaClientMock: vi.fn(),
    PrismaPgMock: vi.fn(),
    disconnectMock: vi.fn(),
    envMock: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      LOG_LEVEL: "info" as string,
    },
  };
});

vi.mock("../../src/generated/prisma/client.js", () => {
  return {
    PrismaClient: hoisted.PrismaClientMock,
  };
});

vi.mock("@prisma/adapter-pg", () => {
  return {
    PrismaPg: hoisted.PrismaPgMock,
  };
});

vi.mock("../../src/config/env.js", () => {
  return {
    env: hoisted.envMock,
  };
});

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    hoisted.PrismaClientMock.mockReset();
    hoisted.PrismaPgMock.mockReset();
    hoisted.disconnectMock.mockReset();
    hoisted.envMock.LOG_LEVEL = "info";

    hoisted.PrismaPgMock.mockImplementation((opts: unknown) => ({ __pgAdapter: opts }));
    hoisted.PrismaClientMock.mockImplementation((config: unknown) => ({
      __config: config,
      $disconnect: hoisted.disconnectMock.mockResolvedValue(undefined),
    }));
  });

  it("does not construct a PrismaClient until getPrismaClient is first called (lazy)", async () => {
    await import("../../src/db/prisma.js");

    expect(hoisted.PrismaClientMock).not.toHaveBeenCalled();
  });

  it("constructs the client with a PrismaPg adapter using env.DATABASE_URL on first call", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();

    expect(hoisted.PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
    expect(hoisted.PrismaClientMock).toHaveBeenCalledTimes(1);
    const config = hoisted.PrismaClientMock.mock.calls[0][0] as { adapter: unknown; log: string[] };
    expect(config.adapter).toEqual({ __pgAdapter: { connectionString: "postgresql://test:test@localhost:5432/test" } });
    expect(client).toBeDefined();
  });

  it("returns the same singleton instance on subsequent calls without reconstructing", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();
    const third = getPrismaClient();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(hoisted.PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("uses the verbose log list when LOG_LEVEL is debug", async () => {
    hoisted.envMock.LOG_LEVEL = "debug";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const config = hoisted.PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(config.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("uses the verbose log list when LOG_LEVEL is trace", async () => {
    hoisted.envMock.LOG_LEVEL = "trace";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const config = hoisted.PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(config.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("uses the terse log list for non-debug/trace log levels", async () => {
    hoisted.envMock.LOG_LEVEL = "warn";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const config = hoisted.PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(config.log).toEqual(["warn", "error"]);
  });

  describe("disconnectPrisma", () => {
    it("is a no-op when no client has been constructed yet", async () => {
      const { disconnectPrisma } = await import("../../src/db/prisma.js");

      await expect(disconnectPrisma()).resolves.toBeUndefined();
      expect(hoisted.disconnectMock).not.toHaveBeenCalled();
    });

    it("calls $disconnect on the existing client and resets the singleton", async () => {
      const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

      getPrismaClient();
      expect(hoisted.PrismaClientMock).toHaveBeenCalledTimes(1);

      await disconnectPrisma();

      expect(hoisted.disconnectMock).toHaveBeenCalledTimes(1);
    });

    it("causes the next getPrismaClient call to construct a fresh instance", async () => {
      const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

      const first = getPrismaClient();
      await disconnectPrisma();
      const second = getPrismaClient();

      expect(hoisted.PrismaClientMock).toHaveBeenCalledTimes(2);
      expect(second).not.toBe(first);
    });
  });
});
