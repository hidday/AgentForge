import { describe, it, expect, vi, beforeEach } from "vitest";

function makeCtorMock() {
  return vi.fn().mockImplementation(function (this: Record<string, unknown>, opts: unknown) {
    this.$opts = opts;
    this.$disconnect = vi.fn().mockResolvedValue(undefined);
  });
}

async function importPrismaModule(logLevel: string) {
  const prismaClientCtor = makeCtorMock();
  const adapterCtor = makeCtorMock();

  vi.doMock("../../src/generated/prisma/client.js", () => ({ PrismaClient: prismaClientCtor }));
  vi.doMock("@prisma/adapter-pg", () => ({ PrismaPg: adapterCtor }));
  vi.doMock("../../src/config/env.js", () => ({
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      LOG_LEVEL: logLevel,
    },
  }));

  const mod = await import("../../src/db/prisma.js");
  return { mod, prismaClientCtor, adapterCtor };
}

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("creates a singleton PrismaClient backed by a pg adapter using the configured connection string", async () => {
    const { mod, prismaClientCtor, adapterCtor } = await importPrismaModule("info");

    const client1 = mod.getPrismaClient();
    const client2 = mod.getPrismaClient();

    expect(client1).toBe(client2);
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
    expect(adapterCtor).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
  });

  it("uses minimal logging (warn/error only) at the default log level", async () => {
    const { mod, prismaClientCtor } = await importPrismaModule("info");

    mod.getPrismaClient();

    const callArgs = prismaClientCtor.mock.calls[0][0] as { log: string[] };
    expect(callArgs.log).toEqual(["warn", "error"]);
  });

  it("enables verbose Prisma query logging when LOG_LEVEL is 'debug'", async () => {
    const { mod, prismaClientCtor } = await importPrismaModule("debug");

    mod.getPrismaClient();

    const callArgs = prismaClientCtor.mock.calls[0][0] as { log: string[] };
    expect(callArgs.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("enables verbose Prisma query logging when LOG_LEVEL is 'trace'", async () => {
    const { mod, prismaClientCtor } = await importPrismaModule("trace");

    mod.getPrismaClient();

    const callArgs = prismaClientCtor.mock.calls[0][0] as { log: string[] };
    expect(callArgs.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("disconnectPrisma disconnects the current client and resets the singleton so the next call creates a new one", async () => {
    const { mod, prismaClientCtor } = await importPrismaModule("info");

    const client1 = mod.getPrismaClient() as unknown as { $disconnect: ReturnType<typeof vi.fn> };
    await mod.disconnectPrisma();

    expect(client1.$disconnect).toHaveBeenCalledTimes(1);

    const client2 = mod.getPrismaClient();
    expect(prismaClientCtor).toHaveBeenCalledTimes(2);
    expect(client2).not.toBe(client1);
  });

  it("disconnectPrisma is a no-op when no client has ever been created", async () => {
    const { mod } = await importPrismaModule("info");
    await expect(mod.disconnectPrisma()).resolves.toBeUndefined();
  });
});
