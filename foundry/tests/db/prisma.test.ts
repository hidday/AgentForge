import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PrismaClientMock = vi.fn();
const disconnectMock = vi.fn().mockResolvedValue(undefined);
const PrismaPgMock = vi.fn();

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

vi.mock("../../src/config/env.js", () => ({
  env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
}));

describe("prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockReset();
    disconnectMock.mockClear();
    PrismaPgMock.mockReset();
    PrismaClientMock.mockImplementation(function (this: unknown) {
      return { $disconnect: disconnectMock };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getPrismaClient memoizes the singleton across calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const a = getPrismaClient();
    const b = getPrismaClient();
    expect(a).toBe(b);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma disconnects and resets the singleton, so the next call constructs a new instance", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);

    await disconnectPrisma();
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a safe no-op when no client was ever created", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("passes the adapter built from env.DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
  });

  it("uses minimal log levels when LOG_LEVEL is info", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("uses verbose log levels when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("uses verbose log levels when LOG_LEVEL is trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "trace" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });
});
