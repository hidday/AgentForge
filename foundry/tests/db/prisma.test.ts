import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrismaClientCtor, mockDisconnect, mockPrismaPgCtor, mockEnv } = vi.hoisted(() => {
  return {
    mockPrismaClientCtor: vi.fn(),
    mockDisconnect: vi.fn().mockResolvedValue(undefined),
    mockPrismaPgCtor: vi.fn(),
    mockEnv: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      LOG_LEVEL: "info" as string,
    },
  };
});

vi.mock("../../src/generated/prisma/client.js", () => {
  class PrismaClient {
    public opts: unknown;
    public $disconnect = mockDisconnect;
    constructor(opts: unknown) {
      this.opts = opts;
      mockPrismaClientCtor(opts);
    }
  }
  return { PrismaClient };
});

vi.mock("@prisma/adapter-pg", () => {
  class PrismaPg {
    public opts: unknown;
    constructor(opts: unknown) {
      this.opts = opts;
      mockPrismaPgCtor(opts);
    }
  }
  return { PrismaPg };
});

vi.mock("../../src/config/env.js", () => ({ env: mockEnv }));

import { getPrismaClient, disconnectPrisma } from "../../src/db/prisma.js";

describe("db/prisma", () => {
  beforeEach(async () => {
    // Ensure the module-level singleton is cleared before every test, and
    // reset mock call state / env so each test starts from a known baseline.
    await disconnectPrisma();
    mockPrismaClientCtor.mockClear();
    mockDisconnect.mockClear();
    mockPrismaPgCtor.mockClear();
    mockEnv.LOG_LEVEL = "info";
  });

  describe("getPrismaClient", () => {
    it("constructs a PrismaClient wired to a PrismaPg adapter using env.DATABASE_URL", () => {
      const client = getPrismaClient();

      expect(client).toBeDefined();
      expect(mockPrismaPgCtor).toHaveBeenCalledWith({
        connectionString: mockEnv.DATABASE_URL,
      });
      expect(mockPrismaClientCtor).toHaveBeenCalledTimes(1);
      const [ctorArgs] = mockPrismaClientCtor.mock.calls[0];
      expect(ctorArgs.adapter).toBeInstanceOf(Object);
    });

    it("uses the default log level (warn, error) when LOG_LEVEL is not debug/trace", () => {
      mockEnv.LOG_LEVEL = "info";

      getPrismaClient();

      const [ctorArgs] = mockPrismaClientCtor.mock.calls[0];
      expect(ctorArgs.log).toEqual(["warn", "error"]);
    });

    it("uses the verbose log level (query, info, warn, error) when LOG_LEVEL is 'debug'", () => {
      mockEnv.LOG_LEVEL = "debug";

      getPrismaClient();

      const [ctorArgs] = mockPrismaClientCtor.mock.calls[0];
      expect(ctorArgs.log).toEqual(["query", "info", "warn", "error"]);
    });

    it("uses the verbose log level (query, info, warn, error) when LOG_LEVEL is 'trace'", () => {
      mockEnv.LOG_LEVEL = "trace";

      getPrismaClient();

      const [ctorArgs] = mockPrismaClientCtor.mock.calls[0];
      expect(ctorArgs.log).toEqual(["query", "info", "warn", "error"]);
    });

    it("returns the same singleton instance on subsequent calls without reconstructing", () => {
      const first = getPrismaClient();
      const second = getPrismaClient();

      expect(second).toBe(first);
      expect(mockPrismaClientCtor).toHaveBeenCalledTimes(1);
      expect(mockPrismaPgCtor).toHaveBeenCalledTimes(1);
    });
  });

  describe("disconnectPrisma", () => {
    it("does nothing when no client has been created yet", async () => {
      await disconnectPrisma();

      expect(mockDisconnect).not.toHaveBeenCalled();
    });

    it("calls $disconnect on the existing client and clears the singleton", async () => {
      const client = getPrismaClient();

      await disconnectPrisma();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
      expect(mockDisconnect.mock.instances[0]).toBe(client);
    });

    it("causes the next getPrismaClient() call to construct a fresh instance", async () => {
      const first = getPrismaClient();
      await disconnectPrisma();

      const second = getPrismaClient();

      expect(second).not.toBe(first);
      expect(mockPrismaClientCtor).toHaveBeenCalledTimes(2);
    });

    it("is safe to call twice in a row (second call is a no-op)", async () => {
      getPrismaClient();
      await disconnectPrisma();
      expect(mockDisconnect).toHaveBeenCalledTimes(1);

      await disconnectPrisma();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });
  });
});
