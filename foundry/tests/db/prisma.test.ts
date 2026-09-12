import { describe, it, expect, vi, beforeEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation((config: unknown) => ({
  __config: config,
  $disconnect: disconnectMock,
}));
const PrismaPgMock = vi.fn().mockImplementation((config: unknown) => ({ __adapterConfig: config }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

let envMock: { DATABASE_URL: string; LOG_LEVEL: string };
vi.mock("../../src/config/env.js", () => ({
  get env() {
    return envMock;
  },
}));

beforeEach(() => {
  vi.resetModules();
  disconnectMock.mockClear();
  PrismaClientMock.mockClear();
  PrismaPgMock.mockClear();
  envMock = { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info" };
});


describe("getPrismaClient", () => {
  it("constructs a PrismaClient wired to a PrismaPg adapter using env.DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("returns the same cached instance on repeated calls (singleton)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("uses the quiet log level (warn, error) when LOG_LEVEL is info", async () => {
    envMock.LOG_LEVEL = "info";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientMock.mock.calls[0][0].log).toEqual(["warn", "error"]);
  });

  it("uses the verbose log level (query, info, warn, error) when LOG_LEVEL is debug", async () => {
    envMock.LOG_LEVEL = "debug";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientMock.mock.calls[0][0].log).toEqual(["query", "info", "warn", "error"]);
  });

  it("uses the verbose log level when LOG_LEVEL is trace", async () => {
    envMock.LOG_LEVEL = "trace";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientMock.mock.calls[0][0].log).toEqual(["query", "info", "warn", "error"]);
  });
});

describe("disconnectPrisma", () => {
  it("disconnects and clears the singleton so the next getPrismaClient() creates a fresh instance", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await disconnectPrisma();

    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
