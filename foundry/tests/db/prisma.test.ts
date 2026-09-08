import { describe, it, expect, vi, beforeEach } from "vitest";

const disconnectMock = vi.fn().mockResolvedValue(undefined);
let lastAdapterOptions: unknown;
let lastClientOptions: unknown;
let constructCount = 0;

vi.mock("../../src/generated/prisma/client.js", () => {
  class FakePrismaClient {
    $disconnect = disconnectMock;
    constructor(options: unknown) {
      constructCount += 1;
      lastClientOptions = options;
    }
  }
  return { PrismaClient: FakePrismaClient };
});

vi.mock("@prisma/adapter-pg", () => {
  class FakePrismaPg {
    constructor(options: unknown) {
      lastAdapterOptions = options;
    }
  }
  return { PrismaPg: FakePrismaPg };
});

describe("db/prisma", () => {
  beforeEach(() => {
    disconnectMock.mockClear();
    constructCount = 0;
    lastAdapterOptions = undefined;
    lastClientOptions = undefined;
  });

  it("getPrismaClient lazily constructs a PrismaClient wired to the pg adapter and DATABASE_URL", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    // Ensure a clean singleton for this test regardless of run order.
    await disconnectPrisma();
    constructCount = 0;

    const client = getPrismaClient();

    expect(client).toBeDefined();
    expect(constructCount).toBe(1);
    expect(lastAdapterOptions).toEqual(
      expect.objectContaining({ connectionString: expect.any(String) }),
    );
    expect(lastClientOptions).toEqual(
      expect.objectContaining({ adapter: expect.anything(), log: expect.any(Array) }),
    );
  });

  it("getPrismaClient returns the same singleton instance on subsequent calls", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    await disconnectPrisma();
    constructCount = 0;

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).toBe(first);
    expect(constructCount).toBe(1);
  });

  it("disconnectPrisma disconnects the existing client and clears the singleton", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    await disconnectPrisma();
    constructCount = 0;
    disconnectMock.mockClear();

    const client = getPrismaClient();
    await disconnectPrisma();

    expect(disconnectMock).toHaveBeenCalledTimes(1);

    // A subsequent getPrismaClient() call constructs a brand-new client
    // (constructCount is now 2: the original "client" plus this rebuild).
    const rebuilt = getPrismaClient();
    expect(rebuilt).not.toBe(client);
    expect(constructCount).toBe(2);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await disconnectPrisma();
    disconnectMock.mockClear();

    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
