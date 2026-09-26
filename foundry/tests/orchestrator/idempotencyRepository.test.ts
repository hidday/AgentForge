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
    it("returns true and calls prisma.processedEvent.create with source/externalEventId when newly recorded", async () => {
      const prisma = makePrisma();
      prisma.processedEvent.create.mockResolvedValue({
        id: "pe-1",
        source: "linear",
        externalEventId: "evt-1",
        createdAt: new Date(),
      });
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when prisma rejects with a P2002 unique constraint error", async () => {
      const prisma = makePrisma();
      const conflict = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      prisma.processedEvent.create.mockRejectedValue(conflict);
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows non-P2002 errors instead of swallowing them", async () => {
      const prisma = makePrisma();
      const error = Object.assign(new Error("connection lost"), { code: "P1001" });
      prisma.processedEvent.create.mockRejectedValue(error);
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow(
        "connection lost",
      );
    });

    it("rethrows errors that are not Error instances or lack a code property", async () => {
      const prisma = makePrisma();
      prisma.processedEvent.create.mockRejectedValue("plain string failure");
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(
        "plain string failure",
      );
    });

    it("rethrows a plain Error without a code property", async () => {
      const prisma = makePrisma();
      prisma.processedEvent.create.mockRejectedValue(new Error("no code here"));
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow(
        "no code here",
      );
    });
  });
});
