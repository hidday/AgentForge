import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
const PrismaClientCtor = vi.fn().mockImplementation((opts: unknown) => ({
  __opts: opts,
  $disconnect: disconnectMock,
}));
const PrismaPgCtor = vi.fn().mockImplementation((opts: unknown) => ({ __pgOpts: opts }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientCtor,
}));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgCtor,
}));
vi.mock("../../src/config/env.js", () => ({
  env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientCtor.mockClear();
    PrismaPgCtor.mockClear();
    disconnectMock.mockClear();
  });

  afterEach(() => {
    vi.doUnmock("../../src/config/env.js");
  });

  it("getPrismaClient() constructs a PrismaClient with a PrismaPg adapter using DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();

    expect(PrismaPgCtor).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
    expect(PrismaClientCtor).toHaveBeenCalledTimes(1);
    expect(client).toBeDefined();
  });

  it("returns the same singleton instance on repeated calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("uses verbose logging when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("uses trace-level logging the same as debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "trace" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("uses minimal logging (warn/error only) when LOG_LEVEL is info", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("disconnectPrisma() disconnects the client and clears the singleton so the next call creates a fresh one", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma() is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
