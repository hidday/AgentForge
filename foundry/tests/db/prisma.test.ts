import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGINAL_LOG_LEVEL = process.env.LOG_LEVEL;

const disconnectMock = vi.fn().mockResolvedValue(undefined);

class FakePrismaClient {
  public options: unknown;
  public $disconnect = disconnectMock;
  constructor(options: unknown) {
    this.options = options;
  }
}

class FakePrismaPg {
  public config: unknown;
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

afterEach(() => {
  vi.resetModules();
  disconnectMock.mockClear();
  if (ORIGINAL_LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = ORIGINAL_LOG_LEVEL;
});

describe("getPrismaClient / disconnectPrisma", () => {
  it("lazily constructs a single PrismaClient instance and reuses it", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    const second = getPrismaClient();
    expect(first).toBeInstanceOf(FakePrismaClient);
    expect(first).toBe(second);
  });

  it("wires the adapter with the configured connection string and a log level", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const client = getPrismaClient() as unknown as FakePrismaClient;
    const options = client.options as { adapter: FakePrismaPg; log: string[] };
    expect(options.adapter).toBeInstanceOf(FakePrismaPg);
    expect(Array.isArray(options.log)).toBe(true);
  });

  it("uses the quiet log level (warn/error only) when LOG_LEVEL is 'info'", async () => {
    vi.resetModules();
    process.env.LOG_LEVEL = "info";
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const client = getPrismaClient() as unknown as FakePrismaClient;
    const options = client.options as { log: string[] };
    expect(options.log).toEqual(["warn", "error"]);
  });

  it("uses the verbose log level (query/info/warn/error) when LOG_LEVEL is 'debug'", async () => {
    vi.resetModules();
    process.env.LOG_LEVEL = "debug";
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const client = getPrismaClient() as unknown as FakePrismaClient;
    const options = client.options as { log: string[] };
    expect(options.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("uses the verbose log level when LOG_LEVEL is 'trace'", async () => {
    vi.resetModules();
    process.env.LOG_LEVEL = "trace";
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const client = getPrismaClient() as unknown as FakePrismaClient;
    const options = client.options as { log: string[] };
    expect(options.log).toEqual(["query", "info", "warn", "error"]);
  });

  it("disconnectPrisma disconnects and clears the singleton so the next call builds a fresh client", async () => {
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
});
