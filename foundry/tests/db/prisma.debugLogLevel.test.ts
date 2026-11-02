import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/config/env.js", () => ({
  env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test", LOG_LEVEL: "debug" },
}));

const PrismaClientMock = vi.fn().mockImplementation(() => ({ $disconnect: vi.fn() }));
vi.mock("../../src/generated/prisma/client.js", () => ({ PrismaClient: PrismaClientMock }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn().mockImplementation(() => ({})) }));

describe("getPrismaClient with LOG_LEVEL=debug", () => {
  it("enables query logging alongside warn/error", async () => {
    const { getPrismaClient } = await import("../../src/db/prisma.js");

    getPrismaClient();

    expect(PrismaClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ log: ["query", "info", "warn", "error"] }),
    );
  });
});
