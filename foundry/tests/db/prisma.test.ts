import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: vi.fn().mockImplementation((options: unknown) => ({
    $disconnect: vi.fn().mockResolvedValue(undefined),
    __options: options,
  })),
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn().mockImplementation((options: unknown) => ({
    __isAdapter: true,
    __options: options,
  })),
}));

import { PrismaClient } from "../../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

describe("prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(PrismaClient).mockClear();
    vi.mocked(PrismaPg).mockClear();
  });

  it("returns the same singleton instance on repeated calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const a = getPrismaClient();
    const b = getPrismaClient();
    expect(a).toBe(b);
    expect(PrismaClient).toHaveBeenCalledTimes(1);
  });

  it("constructs the PrismaClient only once across repeated getPrismaClient calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    getPrismaClient();
    getPrismaClient();
    expect(PrismaClient).toHaveBeenCalledTimes(1);
  });

  it("builds the client with a PrismaPg adapter using env.DATABASE_URL", async () => {
    const { env } = await import("../../src/config/env.js");
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaPg).toHaveBeenCalledWith({ connectionString: env.DATABASE_URL });
    expect(PrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter: expect.objectContaining({ __isAdapter: true }),
      }),
    );
  });

  it("disconnectPrisma calls $disconnect and resets the singleton, so the next call builds a new client", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const disconnectSpy = vi.mocked(first.$disconnect);
    await disconnectPrisma();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(PrismaClient).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();

    expect(PrismaClient).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a no-op when no client has ever been created", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(PrismaClient).not.toHaveBeenCalled();
  });

  describe("log level wiring", () => {
    const originalLogLevel = process.env.LOG_LEVEL;

    afterEach(() => {
      process.env.LOG_LEVEL = originalLogLevel;
    });

    it("enables query/info/warn/error logging when LOG_LEVEL is debug", async () => {
      process.env.LOG_LEVEL = "debug";
      vi.resetModules();
      const { getPrismaClient } = await import("../../src/db/prisma.js");

      getPrismaClient();

      expect(PrismaClient).toHaveBeenCalledWith(
        expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
      );
    });

    it("enables query/info/warn/error logging when LOG_LEVEL is trace", async () => {
      process.env.LOG_LEVEL = "trace";
      vi.resetModules();
      const { getPrismaClient } = await import("../../src/db/prisma.js");

      getPrismaClient();

      expect(PrismaClient).toHaveBeenCalledWith(
        expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
      );
    });

    it("restricts logging to warn/error for other LOG_LEVELs", async () => {
      process.env.LOG_LEVEL = "info";
      vi.resetModules();
      const { getPrismaClient } = await import("../../src/db/prisma.js");

      getPrismaClient();

      expect(PrismaClient).toHaveBeenCalledWith(expect.objectContaining({ log: ["warn", "error"] }));
    });
  });
});
