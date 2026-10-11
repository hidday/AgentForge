import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    processedEvent: {
      create: vi.fn(),
      ...overrides,
    },
  } as never;
}

class PrismaKnownError extends Error {
  code: string;
  constructor(code: string) {
    super("Unique constraint failed");
    this.code = code;
  }
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event when it is new", async () => {
      const create = vi.fn().mockResolvedValue({ id: "pe-1" });
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when the event was already processed (P2002 unique constraint)", async () => {
      const create = vi.fn().mockRejectedValue(new PrismaKnownError("P2002"));
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not a P2002 unique constraint violation", async () => {
      const create = vi.fn().mockRejectedValue(new PrismaKnownError("P2025"));
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow(
        "Unique constraint failed",
      );
    });

    it("rethrows plain errors without a code property", async () => {
      const create = vi.fn().mockRejectedValue(new Error("connection reset"));
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection reset");
    });

    it("rethrows non-Error rejections (e.g. plain string/object throws)", async () => {
      const create = vi.fn().mockRejectedValue("some string rejection");
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("some string rejection");
    });
  });
});
