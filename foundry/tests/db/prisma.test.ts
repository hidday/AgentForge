import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PrismaClientMock = vi.fn().mockImplementation((opts: unknown) => ({
  __opts: opts,
  $disconnect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));

const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ __pgOpts: opts }));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

describe("db/prisma", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    PrismaPgMock.mockClear();
    process.env = {
      ...ORIGINAL_ENV,
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("lazily creates a single PrismaClient instance and reuses it across calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    expect(PrismaClientMock).not.toHaveBeenCalled();

    const a = getPrismaClient();
    const b = getPrismaClient();

    expect(a).toBe(b);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it("wires the pg adapter with the configured DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
  });

  it("configures minimal (warn/error) logging outside debug/trace levels", async () => {
    process.env.LOG_LEVEL = "info";
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("enables verbose query logging when LOG_LEVEL is debug", async () => {
    process.env.LOG_LEVEL = "debug";
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("enables verbose query logging when LOG_LEVEL is trace", async () => {
    process.env.LOG_LEVEL = "trace";
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("disconnects the client and clears the singleton so the next call creates a fresh one", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const first = getPrismaClient() as unknown as { $disconnect: ReturnType<typeof vi.fn> };

    await disconnectPrisma();
    expect(first.$disconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(second).not.toBe(first);
    expect(PrismaClientMock).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(PrismaClientMock).not.toHaveBeenCalled();
  });
});
