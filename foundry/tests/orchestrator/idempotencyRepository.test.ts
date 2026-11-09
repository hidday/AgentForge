import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new IdempotencyRepository(prisma);
  });

  describe("tryMarkProcessed", () => {
    it("returns true and creates a record when the event is new", async () => {
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when the create fails with a unique-constraint violation (P2002)", async () => {
      const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not P2002 unique-constraint violations", async () => {
      const err = Object.assign(new Error("Connection lost"), { code: "P1001" });
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
    });

    it("rethrows errors that are Error instances without a code property", async () => {
      const err = new Error("Unexpected failure");
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow(
        "Unexpected failure",
      );
    });

    it("rethrows non-Error thrown values as-is", async () => {
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        "a raw string failure",
      );

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("a raw string failure");
    });
  });
});
