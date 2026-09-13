import { describe, it, expect, vi, beforeEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
const PrismaClientCtor = vi.fn().mockImplementation(() => ({
  $disconnect: disconnectMock,
}));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientCtor,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn().mockImplementation((opts: unknown) => ({ opts })),
}));

const envMock: { DATABASE_URL: string; LOG_LEVEL: string } = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  LOG_LEVEL: "info",
};

vi.mock("../../src/config/env.js", () => ({
  env: envMock,
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientCtor.mockClear();
    disconnectMock.mockClear();
    envMock.LOG_LEVEL = "info";
  });

  it("getPrismaClient() constructs and returns a PrismaClient instance", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledTimes(1);
    expect(client).toBeDefined();
    expect(client).toHaveProperty("$disconnect");
  });

  it("getPrismaClient() reuses the same singleton instance across calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).toBe(first);
    expect(PrismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma() disconnects the client and clears the singleton so the next call builds a new one", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("getPrismaClient() enables query/info logging when LOG_LEVEL is debug", async () => {
    envMock.LOG_LEVEL = "debug";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("getPrismaClient() enables query/info logging when LOG_LEVEL is trace", async () => {
    envMock.LOG_LEVEL = "trace";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("getPrismaClient() restricts logging to warn/error for a non-debug LOG_LEVEL", async () => {
    envMock.LOG_LEVEL = "info";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("disconnectPrisma() is a safe no-op when no client was ever created", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
