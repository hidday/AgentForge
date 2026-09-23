import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const prismaClientCtor = vi.fn();
const prismaPgCtor = vi.fn();
const disconnectMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/generated/prisma/client.js", () => ({
  PrismaClient: class {
    $disconnect = disconnectMock;
    constructor(...args: unknown[]) {
      prismaClientCtor(...args);
    }
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(...args: unknown[]) {
      prismaPgCtor(...args);
    }
  },
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    LOG_LEVEL: "info",
  },
}));

describe("prisma client singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    prismaClientCtor.mockClear();
    prismaPgCtor.mockClear();
    disconnectMock.mockClear();
  });

  afterEach(() => {
    vi.doUnmock("../../src/config/env.js");
  });

  it("returns the same instance across repeated calls (singleton)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    const a = getPrismaClient();
    const b = getPrismaClient();
    expect(a).toBe(b);
    expect(prismaClientCtor).toHaveBeenCalledTimes(1);
  });

  it("constructs the adapter with the configured connection string", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(prismaPgCtor).toHaveBeenCalledWith({
      connectionString: "postgresql://test:test@localhost:5432/test",
    });
  });

  it("uses the verbose log level list when LOG_LEVEL is info (non-debug/trace)", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(prismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["warn", "error"] }),
    );
  });

  it("disconnects and clears the singleton, so the next call creates a new instance", async () => {
    const { getPrismaClient, disconnectPrisma } = await import("../../src/db/prisma.js");
    const first = getPrismaClient();
    await disconnectPrisma();
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(second).not.toBe(first);
    expect(prismaClientCtor).toHaveBeenCalledTimes(2);
  });

  it("disconnectPrisma is a no-op when no client has been created yet", async () => {
    const { disconnectPrisma } = await import("../../src/db/prisma.js");
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});

describe("prisma client log level branch for debug/trace", () => {
  beforeEach(() => {
    vi.resetModules();
    prismaClientCtor.mockClear();
    prismaPgCtor.mockClear();
    disconnectMock.mockClear();
  });

  afterEach(() => {
    vi.doUnmock("../../src/config/env.js");
  });

  it("uses the verbose query/info/warn/error list when LOG_LEVEL is debug", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(prismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });

  it("uses the verbose query/info/warn/error list when LOG_LEVEL is trace", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "trace" },
    }));
    const { getPrismaClient } = await import("../../src/db/prisma.js");
    getPrismaClient();
    expect(prismaClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });
});
