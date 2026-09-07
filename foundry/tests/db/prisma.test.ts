import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation((opts: unknown) => ({
  __opts: opts,
  $disconnect: disconnectMock,
}));
const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ __adapterOpts: opts }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    PrismaPgMock.mockClear();
    disconnectMock.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("getPrismaClient lazily constructs a PrismaClient with a pg adapter using env.DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const { env } = await import("../../src/config/env.js");

    expect(PrismaClientMock).not.toHaveBeenCalled();

    const client = getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    expect(PrismaPgMock).toHaveBeenCalledWith({ connectionString: env.DATABASE_URL });
    expect(client).toBeDefined();
  });

  it("returns the same cached instance across repeated calls (singleton)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("configures verbose log levels when LOG_LEVEL is debug or trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const callArgs = PrismaClientMock.mock.calls[0]![0] as { log: string[] };
    expect(callArgs.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("configures minimal log levels when LOG_LEVEL is not debug/trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const callArgs = PrismaClientMock.mock.calls[0]![0] as { log: string[] };
    expect(callArgs.log).toEqual(["warn", "error"]);
  });

  it("disconnectPrisma disconnects and clears the cached instance when one exists", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);

    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    // Cached instance was cleared, so the next getPrismaClient call constructs anew.
    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
