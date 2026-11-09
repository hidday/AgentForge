import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Covers the LOG_LEVEL debug/trace branch of getPrismaClient's `log` option,
// which prisma.test.ts (default LOG_LEVEL="info") does not exercise. Isolated
// in its own file so its process.env mutation and module reset don't affect
// the singleton assertions in prisma.test.ts.

const { MockPrismaClient, MockPrismaPg } = vi.hoisted(() => {
  const MockPrismaClient = vi.fn().mockImplementation(function (this: Record<string, unknown>, opts: unknown) {
    this.opts = opts;
    this.$disconnect = vi.fn().mockResolvedValue(undefined);
  });
  const MockPrismaPg = vi.fn().mockImplementation(function (this: Record<string, unknown>, opts: unknown) {
    this.opts = opts;
  });
  return { MockPrismaClient, MockPrismaPg };
});

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: MockPrismaClient,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: MockPrismaPg,
}));

describe("getPrismaClient log level branch", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    MockPrismaClient.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("enables verbose query/info/warn/error logging when LOG_LEVEL is 'debug'", async () => {
    process.env.LOG_LEVEL = "debug";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(MockPrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("enables verbose logging when LOG_LEVEL is 'trace'", async () => {
    process.env.LOG_LEVEL = "trace";
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(MockPrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("limits logging to warn/error at the default LOG_LEVEL", async () => {
    delete process.env.LOG_LEVEL;
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(MockPrismaClient).toHaveBeenCalledWith(expect.objectContaining({ log: ["warn", "error"] }));
  });
});
