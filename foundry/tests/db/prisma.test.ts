import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const PrismaClientMock = vi.fn().mockImplementation(() => ({
  $disconnect: vi.fn().mockResolvedValue(undefined),
}));
const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ opts }));

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
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("getPrismaClient returns the same singleton instance across calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    const second = getPrismaClient();
    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("constructs the client with a log array matching the current LOG_LEVEL", async () => {
    const { env } = await import("../../src/config/env.js");
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    const callArgs = PrismaClientMock.mock.calls[0]?.[0] as { log: string[] };
    const expectedLog =
      env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "trace"
        ? ["query", "info", "warn", "error"]
        : ["warn", "error"];
    expect(callArgs.log).toEqual(expectedLog);
  });

  it("passes a PrismaPg adapter built from env.DATABASE_URL", async () => {
    const { env } = await import("../../src/config/env.js");
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledTimes(1);
    expect(PrismaPgMock).toHaveBeenCalledWith({ connectionString: env.DATABASE_URL });
  });

  it("disconnectPrisma calls $disconnect on the existing client, then getPrismaClient builds a new one", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const client = getPrismaClient() as unknown as { $disconnect: ReturnType<typeof vi.fn> };
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);

    await disconnectPrisma();
    expect(client.$disconnect).toHaveBeenCalledTimes(1);

    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a safe no-op when no client was ever created", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(PrismaClientMock).not.toHaveBeenCalled();
  });

  it("uses the 4-level debug log array when env.LOG_LEVEL is 'debug'", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    const callArgs = PrismaClientMock.mock.calls[0]?.[0] as { log: string[] };
    expect(callArgs.log).toEqual(["query", "info", "warn", "error"]);

    vi.doUnmock("../../src/config/env.js");
  });
});
