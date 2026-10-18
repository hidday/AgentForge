import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

type FakePrisma = ReturnType<typeof makePrisma>;

describe("IdempotencyRepository", () => {
  let prisma: FakePrisma;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new IdempotencyRepository(prisma as unknown as PrismaClient);
  });

  describe("tryMarkProcessed", () => {
    it("returns true and records the event when seen for the first time", async () => {
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

    it("returns false when the event was already processed (unique constraint P2002)", async () => {
      const duplicateError = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      prisma.processedEvent.create.mockRejectedValue(duplicateError);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not a P2002 unique constraint violation", async () => {
      const otherError = Object.assign(new Error("connection reset"), { code: "P1001" });
      prisma.processedEvent.create.mockRejectedValue(otherError);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection reset");
    });

    it("rethrows errors that have no code property at all", async () => {
      prisma.processedEvent.create.mockRejectedValue(new Error("unexpected failure"));

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("unexpected failure");
    });

    it("rethrows non-Error rejection values unchanged", async () => {
      prisma.processedEvent.create.mockRejectedValue({ code: "P2002" });

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toEqual({ code: "P2002" });
    });
  });
});
