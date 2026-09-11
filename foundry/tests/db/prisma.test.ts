import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation(() => ({
  $disconnect: disconnectMock,
}));
const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ opts }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

describe("prisma", () => {
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    PrismaPgMock.mockClear();
    disconnectMock.mockClear();
  });

  afterEach(async () => {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
    // Ensure any singleton created by a test is cleared so it doesn't leak
    // into the next test's module registry expectations.
    const mod = await import("../../src/db/prisma.js");
    await mod.disconnectPrisma();
  });

  it("getPrismaClient() returns the same singleton instance across repeat calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("constructs the PrismaClient with a PrismaPg adapter bound to env.DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledTimes(1);
    const adapterArg = PrismaPgMock.mock.calls[0][0] as { connectionString: string };
    expect(adapterArg.connectionString).toBe(process.env.DATABASE_URL);

    const clientArg = PrismaClientMock.mock.calls[0][0] as { adapter: unknown; log: string[] };
    expect(clientArg.adapter).toBeDefined();
    expect(Array.isArray(clientArg.log)).toBe(true);
  });

  it("disconnectPrisma() calls $disconnect and resets the singleton so the next call creates a new instance", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma() is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("enables verbose (query/info/warn/error) logging when LOG_LEVEL is 'debug'", async () => {
    process.env.LOG_LEVEL = "debug";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const clientArg = PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(clientArg.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("enables verbose logging when LOG_LEVEL is 'trace'", async () => {
    process.env.LOG_LEVEL = "trace";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const clientArg = PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(clientArg.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("restricts logging to warn/error for non-verbose LOG_LEVELs (e.g. 'info')", async () => {
    process.env.LOG_LEVEL = "info";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    const clientArg = PrismaClientMock.mock.calls[0][0] as { log: string[] };
    expect(clientArg.log).toEqual(["warn", "error"]);
  });
});
