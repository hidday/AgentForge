import { describe, it, expect, vi } from "vitest";

let lastClientOptions: { log?: string[] } | undefined;

vi.mock("../../src/generated/prisma/client.js", () => {
  class FakePrismaClient {
    $disconnect = vi.fn().mockResolvedValue(undefined);
    constructor(options: { log?: string[] }) {
      lastClientOptions = options;
    }
  }
  return { PrismaClient: FakePrismaClient };
});

vi.mock("@prisma/adapter-pg", () => {
  class FakePrismaPg {
    constructor(_options: unknown) {}
  }
  return { PrismaPg: FakePrismaPg };
});

vi.mock("../../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/env.js")>();
  return { ...actual, env: { ...actual.env, LOG_LEVEL: "debug" } };
});

describe("db/prisma with LOG_LEVEL=debug", () => {
  it("enables verbose Prisma query/info/warn/error logging", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    await disconnectPrisma();

    getPrismaClient();

    expect(lastClientOptions?.log).toEqual(["query", "info", "warn", "error"]);
  });
});
