import { describe, it, expect, vi, beforeEach } from "vitest";

const PrismaClientMock = vi.fn();
const PrismaPgMock = vi.fn();
const disconnectMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    LOG_LEVEL: "info",
  },
}));

describe("prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockReset();
    PrismaPgMock.mockReset();
    disconnectMock.mockClear();
    PrismaClientMock.mockImplementation(() => ({
      $disconnect: disconnectMock,
    }));
  });

  it("returns the same singleton instance on repeated calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const a = getPrismaClient();
    const b = getPrismaClient();
    expect(a).toBe(b);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("uses verbose query logging when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("uses verbose query logging when LOG_LEVEL is trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "trace" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("uses terse logging (warn/error only) for other log levels", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("passes the connection string through the pg adapter", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
  });

  it("disconnectPrisma calls $disconnect and resets the singleton so a new instance is created next", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    await disconnectPrisma();
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
