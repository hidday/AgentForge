import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildPrismaMock() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

class PrismaKnownError extends Error {
  code: string;
  constructor(code: string, message = "unique constraint failed") {
    super(message);
    this.code = code;
  }
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event when it is seen for the first time", async () => {
      const prisma = buildPrismaMock();
      prisma.processedEvent.create.mockResolvedValue({});
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when prisma throws a P2002 unique-constraint error (duplicate)", async () => {
      const prisma = buildPrismaMock();
      prisma.processedEvent.create.mockRejectedValue(new PrismaKnownError("P2002"));
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not P2002", async () => {
      const prisma = buildPrismaMock();
      const otherError = new PrismaKnownError("P2003", "foreign key constraint failed");
      prisma.processedEvent.create.mockRejectedValue(otherError);
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(otherError);
    });

    it("rethrows non-Error, non-coded rejections as-is", async () => {
      const prisma = buildPrismaMock();
      prisma.processedEvent.create.mockRejectedValue(new Error("plain failure, no code"));
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow(
        "plain failure, no code",
      );
    });

    it("rethrows a thrown non-Error value unchanged", async () => {
      const prisma = buildPrismaMock();
      prisma.processedEvent.create.mockRejectedValue("string failure");
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("string failure");
    });
  });
});
