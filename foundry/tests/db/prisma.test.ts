import { describe, it, expect, vi, beforeEach } from "vitest";

const DATABASE_URL = "postgresql://mock-user:mock-pass@localhost:5432/mockdb";

// A mutable mock env so individual tests can flip LOG_LEVEL without
// re-importing the module under test. Declared via vi.hoisted so it exists
// before the hoisted vi.mock factory below runs.
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { DATABASE_URL: "postgresql://mock-user:mock-pass@localhost:5432/mockdb", LOG_LEVEL: "info" },
}));

vi.mock("../../src/config/env.js", () => ({
  env: mockEnv,
}));

vi.mock("../../src/generated/prisma/client.js", () => {
  const PrismaClient = vi.fn(function PrismaClientMock(
    this: { config: unknown; $disconnect: ReturnType<typeof vi.fn> },
    config: unknown,
  ) {
    this.config = config;
    this.$disconnect = vi.fn().mockResolvedValue(undefined);
  });
  return { PrismaClient };
});

vi.mock("@prisma/adapter-pg", () => {
  const PrismaPg = vi.fn(function PrismaPgMock(
    this: { config: unknown },
    config: unknown,
  ) {
    this.config = config;
  });
  return { PrismaPg };
});

import { PrismaClient } from "../../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { getPrismaClient, disconnectPrisma } from "../../src/db/prisma.js";

const MockedPrismaClient = PrismaClient as unknown as ReturnType<typeof vi.fn>;
const MockedPrismaPg = PrismaPg as unknown as ReturnType<typeof vi.fn>;

describe("prisma", () => {
  beforeEach(async () => {
    // Ensure no leftover singleton from a previous test leaks across cases.
    await disconnectPrisma();
    MockedPrismaClient.mockClear();
    MockedPrismaPg.mockClear();
    mockEnv.LOG_LEVEL = "info";
  });

  describe("getPrismaClient", () => {
    it("constructs a client on first call and memoizes it as a singleton", () => {
      const first = getPrismaClient();
      const second = getPrismaClient();

      expect(first).toBe(second);
      expect(MockedPrismaClient).toHaveBeenCalledTimes(1);
    });

    it("builds the adapter from PrismaPg using env.DATABASE_URL", () => {
      getPrismaClient();

      expect(MockedPrismaPg).toHaveBeenCalledTimes(1);
      expect(MockedPrismaPg).toHaveBeenCalledWith({ connectionString: DATABASE_URL });

      const passedConfig = MockedPrismaClient.mock.calls[0][0] as { adapter: unknown };
      expect(passedConfig.adapter).toBe(MockedPrismaPg.mock.instances[0]);
    });

    it("passes the verbose log config when LOG_LEVEL is 'debug'", () => {
      mockEnv.LOG_LEVEL = "debug";

      getPrismaClient();

      const passedConfig = MockedPrismaClient.mock.calls[0][0] as { log: string[] };
      expect(passedConfig.log).toEqual(["query", "info", "warn", "error"]);
    });

    it("passes the verbose log config when LOG_LEVEL is 'trace'", () => {
      mockEnv.LOG_LEVEL = "trace";

      getPrismaClient();

      const passedConfig = MockedPrismaClient.mock.calls[0][0] as { log: string[] };
      expect(passedConfig.log).toEqual(["query", "info", "warn", "error"]);
    });

    it("passes the minimal log config for any other LOG_LEVEL (e.g. 'info')", () => {
      mockEnv.LOG_LEVEL = "info";

      getPrismaClient();

      const passedConfig = MockedPrismaClient.mock.calls[0][0] as { log: string[] };
      expect(passedConfig.log).toEqual(["warn", "error"]);
    });

    it("passes the minimal log config for 'warn' (not debug/trace)", () => {
      mockEnv.LOG_LEVEL = "warn";

      getPrismaClient();

      const passedConfig = MockedPrismaClient.mock.calls[0][0] as { log: string[] };
      expect(passedConfig.log).toEqual(["warn", "error"]);
    });

    it("does not reconstruct the client when LOG_LEVEL changes after the first call", () => {
      mockEnv.LOG_LEVEL = "info";
      const first = getPrismaClient();

      mockEnv.LOG_LEVEL = "debug";
      const second = getPrismaClient();

      expect(second).toBe(first);
      expect(MockedPrismaClient).toHaveBeenCalledTimes(1);
    });
  });

  describe("disconnectPrisma", () => {
    it("calls $disconnect on the existing client and clears the singleton", async () => {
      const client = getPrismaClient() as unknown as { $disconnect: ReturnType<typeof vi.fn> };

      await disconnectPrisma();

      expect(client.$disconnect).toHaveBeenCalledTimes(1);

      // A subsequent call constructs a brand-new client instance.
      const next = getPrismaClient();
      expect(next).not.toBe(client);
      expect(MockedPrismaClient).toHaveBeenCalledTimes(2);
    });

    it("is a no-op when no client has been created yet", async () => {
      await expect(disconnectPrisma()).resolves.toBeUndefined();
      expect(MockedPrismaClient).not.toHaveBeenCalled();
    });

    it("is safe to call twice in a row", async () => {
      const client = getPrismaClient() as unknown as { $disconnect: ReturnType<typeof vi.fn> };

      await disconnectPrisma();
      await disconnectPrisma();

      // Second disconnect found no client, so $disconnect was not called again.
      expect(client.$disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
