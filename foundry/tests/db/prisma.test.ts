import { describe, it, expect, vi } from "vitest";

const { PrismaClientMock } = vi.hoisted(() => ({
  PrismaClientMock: vi.fn().mockImplementation((options: unknown) => ({
    options,
    $disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}));

const { PrismaPgMock } = vi.hoisted(() => ({
  PrismaPgMock: vi.fn().mockImplementation((options: unknown) => ({ options })),
}));

const { envMock } = vi.hoisted(() => ({
  envMock: {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/agentforge",
    LOG_LEVEL: "info",
  } as { DATABASE_URL: string; LOG_LEVEL: string },
}));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

vi.mock("../../src/config/env.js", () => ({
  env: envMock,
}));

import { getPrismaClient, disconnectPrisma } from "../../src/db/prisma.js";

describe("prisma singleton", () => {
  it("disconnectPrisma is a no-op when no client has ever been created", async () => {
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(PrismaClientMock).not.toHaveBeenCalled();
  });

  it("constructs a client on first call, with the configured connection string and warn/error logging by default", () => {
    envMock.LOG_LEVEL = "info";
    envMock.DATABASE_URL = "postgresql://user:pass@localhost:5432/agentforge";

    const client = getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledTimes(1);
    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://user:pass@localhost:5432/agentforge",
    });
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    const ctorArgs = PrismaClientMock.mock.calls[0]![0] as { adapter: unknown; log: string[] };
    expect(ctorArgs.log).toEqual(["warn", "error"]);
    expect(ctorArgs.adapter).toBe(PrismaPgMock.mock.results[0]!.value);
    expect(client).toBe(PrismaClientMock.mock.results[0]!.value);
  });

  it("reuses the same singleton instance on a second call without constructing again", () => {
    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).toBe(first);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("disconnectPrisma calls $disconnect on the existing client and clears the singleton", async () => {
    const existing = getPrismaClient() as unknown as { $disconnect: ReturnType<typeof vi.fn> };
    expect(PrismaClientMock).toHaveBeenCalledTimes(1); // still the same instance from before

    await disconnectPrisma();

    expect(existing.$disconnect).toHaveBeenCalledTimes(1);

    // A subsequent call constructs a brand-new client.
    const rebuilt = getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    expect(rebuilt).not.toBe(existing);
  });

  it("uses debug-level query logging when env.LOG_LEVEL is 'debug'", async () => {
    await disconnectPrisma();
    envMock.LOG_LEVEL = "debug";

    getPrismaClient();

    const lastCall = PrismaClientMock.mock.calls[PrismaClientMock.mock.calls.length - 1]![0] as {
      log: string[];
    };
    expect(lastCall.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("uses debug-level query logging when env.LOG_LEVEL is 'trace'", async () => {
    await disconnectPrisma();
    envMock.LOG_LEVEL = "trace";

    getPrismaClient();

    const lastCall = PrismaClientMock.mock.calls[PrismaClientMock.mock.calls.length - 1]![0] as {
      log: string[];
    };
    expect(lastCall.log).toEqual(["query", "info", "warn", "error"]);
  });
});
