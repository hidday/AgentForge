import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrismaMock() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient & {
    processedEvent: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

class PrismaKnownError extends Error {
  code: string;
  constructor(code: string) {
    super("Unique constraint failed");
    this.code = code;
  }
}

describe("IdempotencyRepository", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new IdempotencyRepository(prisma);
  });

  describe("tryMarkProcessed", () => {
    it("returns true when the event is newly recorded", async () => {
      prisma.processedEvent.create.mockResolvedValue({
        id: "pe-1",
        source: "linear",
        externalEventId: "evt-1",
      });

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false on a P2002 unique constraint violation (duplicate)", async () => {
      prisma.processedEvent.create.mockRejectedValue(new PrismaKnownError("P2002"));

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not P2002", async () => {
      prisma.processedEvent.create.mockRejectedValue(new PrismaKnownError("P2003"));

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow(
        "Unique constraint failed",
      );
    });

    it("rethrows errors without a code property", async () => {
      prisma.processedEvent.create.mockRejectedValue(new Error("network failure"));

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("network failure");
    });

    it("rethrows non-Error rejections", async () => {
      prisma.processedEvent.create.mockRejectedValue("plain string failure");

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("plain string failure");
    });
  });
});
