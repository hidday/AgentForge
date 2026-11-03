import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation((options: unknown) => ({
  $disconnect: disconnectMock,
  __options: options,
}));
const PrismaPgMock = vi.fn().mockImplementation((options: unknown) => ({ __adapterOptions: options }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

vi.mock("../../src/config/env.js", () => ({
  env: { DATABASE_URL: "postgresql://user:pass@localhost:5432/db", LOG_LEVEL: "info" },
}));

async function importPrismaModule() {
  return import("../../src/db/prisma.js");
}

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    PrismaPgMock.mockClear();
    disconnectMock.mockClear();
  });

  afterEach(() => {
    vi.doUnmock("../../src/config/env.js");
    vi.resetModules();
  });

  it("constructs a PrismaClient with a PrismaPg adapter wired to DATABASE_URL", async () => {
    const { getPrismaClient } = await importPrismaModule();
    getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://user:pass@localhost:5432/db",
    });
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    const callArgs = PrismaClientMock.mock.calls[0]![0] as { adapter: unknown; log: string[] };
    expect(callArgs.adapter).toEqual({
      __adapterOptions: { connectionString: "postgresql://user:pass@localhost:5432/db" },
    });
  });

  it("uses the quiet log level (warn/error only) when LOG_LEVEL is info", async () => {
    const { getPrismaClient } = await importPrismaModule();
    getPrismaClient();
    const callArgs = PrismaClientMock.mock.calls[0]![0] as { log: string[] };
    expect(callArgs.log).toEqual(["warn", "error"]);
  });

  it("returns the same singleton instance on repeated calls without constructing twice", async () => {
    const { getPrismaClient } = await importPrismaModule();
    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).toBe(first);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma disconnects the client and clears the singleton so the next call creates a new one", async () => {
    const { getPrismaClient, disconnectPrisma } = await importPrismaModule();
    const first = getPrismaClient();

    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await importPrismaModule();
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("enables verbose logging (query/info/warn/error) when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://user:pass@localhost:5432/db", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await importPrismaModule();
    getPrismaClient();
    const callArgs = PrismaClientMock.mock.calls[0]![0] as { log: string[] };
    expect(callArgs.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("enables verbose logging when LOG_LEVEL is trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://user:pass@localhost:5432/db", LOG_LEVEL: "trace" },
    }));
    const { getPrismaClient } = await importPrismaModule();
    getPrismaClient();
    const callArgs = PrismaClientMock.mock.calls[0]![0] as { log: string[] };
    expect(callArgs.log).toEqual(["query", "info", "warn", "error"]);
  });
});
