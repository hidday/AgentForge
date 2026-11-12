import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const PrismaClientMock = vi.fn().mockImplementation(() => ({ $disconnect: mockDisconnect }));
const PrismaPgMock = vi.fn().mockImplementation((opts: unknown) => ({ opts }));

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: PrismaClientMock,
}));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: PrismaPgMock,
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaClientMock.mockClear();
    PrismaPgMock.mockClear();
    mockDisconnect.mockClear();
  });

  describe("getPrismaClient", () => {
    it("creates a single PrismaClient instance and reuses it on subsequent calls", async () => {
      const { getPrismaClient } = await import("../../src/db/prisma.js");

      const a = getPrismaClient();
      const b = getPrismaClient();

      expect(a).toBe(b);
      expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    });

    it("configures the pg adapter with the connection string from env.DATABASE_URL", async () => {
      const { getPrismaClient } = await import("../../src/db/prisma.js");
      const { env } = await import("../../src/config/env.js");

      getPrismaClient();

      expect(PrismaPgMock).toHaveBeenCalledWith({ connectionString: env.DATABASE_URL });
    });

    it("uses only warn/error logging when LOG_LEVEL is not debug/trace", async () => {
      const { getPrismaClient } = await import("../../src/db/prisma.js");
      const { env } = await import("../../src/config/env.js");
      expect(["debug", "trace"]).not.toContain(env.LOG_LEVEL);

      getPrismaClient();

      expect(PrismaClientMock).toHaveBeenCalledWith(
        expect.objectContaining({ log: ["warn", "error"] }),
      );
    });

    it("includes query/info logging when LOG_LEVEL is debug", async () => {
      const previousLogLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = "debug";
      try {
        const { getPrismaClient } = await import("../../src/db/prisma.js");

        getPrismaClient();

        expect(PrismaClientMock).toHaveBeenCalledWith(
          expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
        );
      } finally {
        if (previousLogLevel === undefined) {
          delete process.env.LOG_LEVEL;
        } else {
          process.env.LOG_LEVEL = previousLogLevel;
        }
      }
    });
  });

  describe("disconnectPrisma", () => {
    it("is a no-op when no client has been created yet", async () => {
      const { disconnectPrisma } = await import("../../src/db/prisma.js");

      await disconnectPrisma();

      expect(mockDisconnect).not.toHaveBeenCalled();
    });

    it("disconnects the existing client and clears the singleton so a fresh one is built next", async () => {
      const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

      const first = getPrismaClient();
      await disconnectPrisma();
      expect(mockDisconnect).toHaveBeenCalledTimes(1);

      const second = getPrismaClient();

      expect(second).not.toBe(first);
      expect(PrismaClientMock).toHaveBeenCalledTimes(2);
    });
  });
});
