import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event when it has not been seen before", async () => {
      const prisma = makePrisma();
      prisma.processedEvent.create.mockResolvedValue({
        id: "1",
        source: "linear",
        externalEventId: "evt-1",
        createdAt: new Date(),
      });
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(true);
      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
    });

    it("returns false on a unique-constraint violation (P2002), signalling a duplicate", async () => {
      const prisma = makePrisma();
      const dupError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      prisma.processedEvent.create.mockRejectedValue(dupError);
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not P2002 unique-constraint violations", async () => {
      const prisma = makePrisma();
      const otherError = Object.assign(new Error("connection lost"), { code: "P1001" });
      prisma.processedEvent.create.mockRejectedValue(otherError);
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection lost");
    });

    it("rethrows a plain Error that has no code property", async () => {
      const prisma = makePrisma();
      prisma.processedEvent.create.mockRejectedValue(new Error("boom"));
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("boom");
    });

    it("rethrows a non-Error rejection value as-is", async () => {
      const prisma = makePrisma();
      prisma.processedEvent.create.mockRejectedValue("string rejection");
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("string rejection");
    });
  });
});
