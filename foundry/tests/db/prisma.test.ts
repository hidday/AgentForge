import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);

class FakePrismaClient {
  public readonly options: unknown;
  public $disconnect = disconnectMock;

  constructor(options: unknown) {
    this.options = options;
  }
}

class FakePrismaPg {
  public readonly config: unknown;

  constructor(config: unknown) {
    this.config = config;
  }
}

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: FakePrismaClient,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: FakePrismaPg,
}));

describe("db/prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    disconnectMock.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("getPrismaClient constructs a PrismaClient wired to a PrismaPg adapter using env.DATABASE_URL", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const { env } = await import("../../src/config/env.js");

    const client = getPrismaClient();

    expect(client).toBeInstanceOf(FakePrismaClient);
    const options = (client as unknown as FakePrismaClient).options as {
      adapter: FakePrismaPg;
      log: string[];
    };
    expect(options.adapter).toBeInstanceOf(FakePrismaPg);
    expect((options.adapter as unknown as FakePrismaPg).config).toEqual({
      connectionString: env.DATABASE_URL,
    });
  });

  it("memoizes the client across repeated calls", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
  });

  it("disconnectPrisma disconnects and clears the memoized client, so the next call builds a new one", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");

    const first = getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("uses verbose log levels when LOG_LEVEL is debug or trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    const client = getPrismaClient() as unknown as FakePrismaClient;
    const options = client.options as { log: string[] };
    expect(options.log).toEqual(["query", "info", "warn", "error"]);
  });
});
