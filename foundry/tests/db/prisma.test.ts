import { describe, it, expect, vi, beforeEach } from "vitest";

const PrismaClientMock = vi.fn().mockImplementation(function (
  this: { opts: unknown; $disconnect: () => Promise<void> },
  opts: unknown,
) {
  this.opts = opts;
  this.$disconnect = vi.fn().mockResolvedValue(undefined);
});
const PrismaPgMock = vi.fn().mockImplementation(function (this: { opts: unknown }, opts: unknown) {
  this.opts = opts;
});

vi.mock("../../src/generated/prisma/client.js", () => ({ PrismaClient: PrismaClientMock }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: PrismaPgMock }));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    PrismaPgMock.mockClear();
  });

  it("constructs a PrismaClient with a pg adapter from env.DATABASE_URL and default log levels", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://x", LOG_LEVEL: "info" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledWith({ connectionString: "postgresql://x" });
    expect(PrismaClientMock).toHaveBeenCalledWith(expect.objectContaining({ log: ["warn", "error"] }));
    expect(client).toBeInstanceOf(PrismaClientMock);
  });

  it("enables verbose query logging when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://x", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("enables verbose query logging when LOG_LEVEL is trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://x", LOG_LEVEL: "trace" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("keeps warn/error-only logging for levels other than debug/trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://x", LOG_LEVEL: "error" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(expect.objectContaining({ log: ["warn", "error"] }));
  });

  it("returns the same client instance on repeated calls (singleton)", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://x", LOG_LEVEL: "info" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("disconnects and clears the singleton so the next call constructs a fresh client", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://x", LOG_LEVEL: "info" },
    }));
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient() as unknown as { $disconnect: ReturnType<typeof vi.fn> };
    await disconnectPrisma();
    const second = getPrismaClient();

    expect(first.$disconnect).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when disconnecting before any client was ever created", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://x", LOG_LEVEL: "info" },
    }));
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(PrismaClientMock).not.toHaveBeenCalled();
  });
});
