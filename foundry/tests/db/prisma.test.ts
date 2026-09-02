import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const CLIENT_MODULE = "../../src/generated/prisma/client.js";
const ADAPTER_MODULE = "@prisma/adapter-pg";
const ENV_MODULE = "../../src/config/env.js";
const TARGET_MODULE = "../../src/db/prisma.js";

async function loadPrismaModule(envOverrides: Partial<{ DATABASE_URL: string; LOG_LEVEL: string }> = {}) {
  vi.resetModules();

  const disconnect = vi.fn().mockResolvedValue(undefined);
  const PrismaClientMock = vi.fn().mockImplementation(() => ({ $disconnect: disconnect }));
  const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ __adapterOpts: opts }));

  vi.doMock(CLIENT_MODULE, () => ({ PrismaClient: PrismaClientMock }));
  vi.doMock(ADAPTER_MODULE, () => ({ PrismaPg: PrismaPgMock }));
  vi.doMock(ENV_MODULE, () => ({
    env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "info", ...envOverrides },
  }));

  const mod = await import(TARGET_MODULE);
  return { mod, PrismaClientMock, PrismaPgMock, disconnect };
}

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock(CLIENT_MODULE);
    vi.doUnmock(ADAPTER_MODULE);
    vi.doUnmock(ENV_MODULE);
    vi.restoreAllMocks();
  });

  it("getPrismaClient constructs a PrismaClient with a pg adapter using env.DATABASE_URL", async () => {
    const { mod, PrismaClientMock, PrismaPgMock } = await loadPrismaModule({
      DATABASE_URL: "postgresql://custom-host/db",
    });

    mod.getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledWith({ connectionString: "postgresql://custom-host/db" });
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    const ctorArgs = PrismaClientMock.mock.calls[0][0];
    expect(ctorArgs.adapter).toEqual({ __adapterOpts: { connectionString: "postgresql://custom-host/db" } });
  });

  it("getPrismaClient reuses the singleton instance across calls instead of reconstructing", async () => {
    const { mod, PrismaClientMock } = await loadPrismaModule();

    const first = mod.getPrismaClient();
    const second = mod.getPrismaClient();

    expect(first).toBe(second);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("uses verbose query/info/warn/error logging when LOG_LEVEL is debug", async () => {
    const { mod, PrismaClientMock } = await loadPrismaModule({ LOG_LEVEL: "debug" });

    mod.getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("uses verbose query/info/warn/error logging when LOG_LEVEL is trace", async () => {
    const { mod, PrismaClientMock } = await loadPrismaModule({ LOG_LEVEL: "trace" });

    mod.getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("uses minimal warn/error logging for non-debug log levels", async () => {
    const { mod, PrismaClientMock } = await loadPrismaModule({ LOG_LEVEL: "info" });

    mod.getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(expect.objectContaining({ log: ["warn", "error"] }));
  });

  it("disconnectPrisma disconnects the existing client and clears the singleton", async () => {
    const { mod, PrismaClientMock, disconnect } = await loadPrismaModule();

    const first = mod.getPrismaClient();
    await mod.disconnectPrisma();

    expect(disconnect).toHaveBeenCalledTimes(1);

    const second = mod.getPrismaClient();

    expect(second).not.toBe(first);
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a no-op when no client has ever been constructed", async () => {
    const { mod, PrismaClientMock } = await loadPrismaModule();

    await expect(mod.disconnectPrisma()).resolves.toBeUndefined();

    expect(PrismaClientMock).not.toHaveBeenCalled();
  });
});
