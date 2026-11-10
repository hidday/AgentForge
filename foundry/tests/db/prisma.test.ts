import { describe, it, expect, vi, afterEach } from "vitest";

const CLIENT_MODULE = "../../src/generated/prisma/client.js";
const ADAPTER_MODULE = "@prisma/adapter-pg";
const ENV_MODULE = "../../src/config/env.js";
const PRISMA_MODULE = "../../src/db/prisma.js";

async function loadPrismaModule(logLevel: string, databaseUrl = "postgresql://u:p@localhost:5432/db") {
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const PrismaClientCtor = vi.fn().mockImplementation((opts: unknown) => ({
    __opts: opts,
    $disconnect: disconnect,
  }));
  const PrismaPgCtor = vi.fn().mockImplementation((opts: unknown) => ({ __adapterOpts: opts }));

  vi.doMock(CLIENT_MODULE, () => ({ PrismaClient: PrismaClientCtor }));
  vi.doMock(ADAPTER_MODULE, () => ({ PrismaPg: PrismaPgCtor }));
  vi.doMock(ENV_MODULE, () => ({
    env: { DATABASE_URL: databaseUrl, LOG_LEVEL: logLevel },
  }));

  const mod = await import(PRISMA_MODULE);
  return { mod, PrismaClientCtor, PrismaPgCtor, disconnect };
}

describe("db/prisma", () => {
  afterEach(() => {
    vi.doUnmock(CLIENT_MODULE);
    vi.doUnmock(ADAPTER_MODULE);
    vi.doUnmock(ENV_MODULE);
    vi.resetModules();
  });

  it("getPrismaClient() constructs the client once and returns the same instance on repeated calls", async () => {
    const { mod, PrismaClientCtor } = await loadPrismaModule("info");

    const client1 = mod.getPrismaClient();
    const client2 = mod.getPrismaClient();
    const client3 = mod.getPrismaClient();

    expect(client1).toBe(client2);
    expect(client2).toBe(client3);
    expect(PrismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("builds a PrismaPg adapter from env.DATABASE_URL", async () => {
    const { mod, PrismaPgCtor } = await loadPrismaModule("info", "postgresql://a:b@host:5432/mydb");

    mod.getPrismaClient();

    expect(PrismaPgCtor).toHaveBeenCalledTimes(1);
    expect(PrismaPgCtor).toHaveBeenCalledWith({
      connectionString: "postgresql://a:b@host:5432/mydb",
    });
  });

  it("uses verbose log levels (query/info/warn/error) when LOG_LEVEL=debug", async () => {
    const { mod, PrismaClientCtor } = await loadPrismaModule("debug");

    mod.getPrismaClient();

    const opts = PrismaClientCtor.mock.calls[0][0] as { log: string[] };
    expect(opts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("uses verbose log levels when LOG_LEVEL=trace", async () => {
    const { mod, PrismaClientCtor } = await loadPrismaModule("trace");

    mod.getPrismaClient();

    const opts = PrismaClientCtor.mock.calls[0][0] as { log: string[] };
    expect(opts.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("uses only warn/error log levels for a non-debug, non-trace LOG_LEVEL", async () => {
    const { mod, PrismaClientCtor } = await loadPrismaModule("info");

    mod.getPrismaClient();

    const opts = PrismaClientCtor.mock.calls[0][0] as { log: string[] };
    expect(opts.log).toEqual(["warn", "error"]);
  });

  it("disconnectPrisma() calls $disconnect on the existing instance and clears the singleton", async () => {
    const { mod, disconnect, PrismaClientCtor } = await loadPrismaModule("info");

    const client1 = mod.getPrismaClient();
    await mod.disconnectPrisma();

    expect(disconnect).toHaveBeenCalledTimes(1);

    const client2 = mod.getPrismaClient();
    expect(PrismaClientCtor).toHaveBeenCalledTimes(2);
    expect(client2).not.toBe(client1);
  });

  it("disconnectPrisma() is a no-op when no client has been constructed yet", async () => {
    const { mod, disconnect } = await loadPrismaModule("info");

    await expect(mod.disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
