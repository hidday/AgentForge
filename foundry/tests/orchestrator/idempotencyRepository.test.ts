import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function buildPrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

class PrismaKnownError extends Error {
  code: string;
  constructor(code: string) {
    super("prisma error");
    this.code = code;
  }
}

describe("IdempotencyRepository", () => {
  it("tryMarkProcessed() returns true and creates a record for a new event", async () => {
    const prisma = buildPrisma();
    prisma.processedEvent.create.mockResolvedValue({ source: "linear", externalEventId: "ext-1" });
    const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

    const result = await repo.tryMarkProcessed("linear", "ext-1");

    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "ext-1" },
    });
  });

  it("tryMarkProcessed() returns false on a unique-constraint violation (P2002), i.e. a duplicate", async () => {
    const prisma = buildPrisma();
    prisma.processedEvent.create.mockRejectedValue(new PrismaKnownError("P2002"));
    const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

    const result = await repo.tryMarkProcessed("linear", "ext-1");

    expect(result).toBe(false);
  });

  it("tryMarkProcessed() rethrows errors that are not a P2002 unique-constraint violation", async () => {
    const prisma = buildPrisma();
    prisma.processedEvent.create.mockRejectedValue(new PrismaKnownError("P9999"));
    const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

    await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toThrow("prisma error");
  });

  it("tryMarkProcessed() rethrows non-Error, non-code-bearing rejections as-is", async () => {
    const prisma = buildPrisma();
    prisma.processedEvent.create.mockRejectedValue("plain string failure");
    const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

    await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toBe("plain string failure");
  });
});
