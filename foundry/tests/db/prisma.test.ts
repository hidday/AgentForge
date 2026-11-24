import { describe, it, expect, vi, afterEach } from "vitest";

const CLIENT_MODULE = "../../src/generated/prisma/client.js";
const ADAPTER_MODULE = "@prisma/adapter-pg";

describe("db/prisma", () => {
  const originalLogLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
    vi.doUnmock(CLIENT_MODULE);
    vi.doUnmock(ADAPTER_MODULE);
    vi.resetModules();
  });

  it("getPrismaClient lazily constructs a single PrismaClient instance and reuses it", async () => {
    const PrismaClientMock = vi.fn().mockImplementation((opts: unknown) => ({ opts }));
    vi.doMock(CLIENT_MODULE, () => ({ PrismaClient: PrismaClientMock }));
    vi.doMock(ADAPTER_MODULE, () => ({ PrismaPg: vi.fn().mockImplementation((o: unknown) => o) }));
    vi.resetModules();

    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const a = getPrismaClient();
    const b = getPrismaClient();

    expect(a).toBe(b);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("enables query logging when LOG_LEVEL is debug", async () => {
    process.env.LOG_LEVEL = "debug";
    const PrismaClientMock = vi.fn().mockImplementation((opts: unknown) => ({ opts }));
    vi.doMock(CLIENT_MODULE, () => ({ PrismaClient: PrismaClientMock }));
    vi.doMock(ADAPTER_MODULE, () => ({ PrismaPg: vi.fn() }));
    vi.resetModules();

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("enables query logging when LOG_LEVEL is trace", async () => {
    process.env.LOG_LEVEL = "trace";
    const PrismaClientMock = vi.fn().mockImplementation((opts: unknown) => ({ opts }));
    vi.doMock(CLIENT_MODULE, () => ({ PrismaClient: PrismaClientMock }));
    vi.doMock(ADAPTER_MODULE, () => ({ PrismaPg: vi.fn() }));
    vi.resetModules();

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("restricts logging to warn/error at higher log levels", async () => {
    process.env.LOG_LEVEL = "info";
    const PrismaClientMock = vi.fn().mockImplementation((opts: unknown) => ({ opts }));
    vi.doMock(CLIENT_MODULE, () => ({ PrismaClient: PrismaClientMock }));
    vi.doMock(ADAPTER_MODULE, () => ({ PrismaPg: vi.fn() }));
    vi.resetModules();

    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("disconnectPrisma disconnects and clears the singleton so the next call constructs anew", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const PrismaClientMock = vi.fn().mockImplementation(() => ({ $disconnect: disconnect }));
    vi.doMock(CLIENT_MODULE, () => ({ PrismaClient: PrismaClientMock }));
    vi.doMock(ADAPTER_MODULE, () => ({ PrismaPg: vi.fn() }));
    vi.resetModules();

    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    getPrismaClient();
    await disconnectPrisma();

    expect(disconnect).toHaveBeenCalledTimes(1);

    getPrismaClient();
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const PrismaClientMock = vi.fn();
    vi.doMock(CLIENT_MODULE, () => ({ PrismaClient: PrismaClientMock }));
    vi.doMock(ADAPTER_MODULE, () => ({ PrismaPg: vi.fn() }));
    vi.resetModules();

    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(PrismaClientMock).not.toHaveBeenCalled();
  });
});
