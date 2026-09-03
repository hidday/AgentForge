import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildPrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event when it has not been seen before", async () => {
      const prisma = buildPrisma();
      prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false on a unique constraint violation (P2002), i.e. a duplicate event", async () => {
      const prisma = buildPrisma();
      const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      prisma.processedEvent.create.mockRejectedValue(conflict);
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not a P2002 unique constraint violation", async () => {
      const prisma = buildPrisma();
      const other = Object.assign(new Error("connection lost"), { code: "P1001" });
      prisma.processedEvent.create.mockRejectedValue(other);
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection lost");
    });

    it("rethrows non-Error rejections (no `code` property to inspect)", async () => {
      const prisma = buildPrisma();
      prisma.processedEvent.create.mockRejectedValue("some string failure");
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("some string failure");
    });

    it("rethrows an Error without a `code` property", async () => {
      const prisma = buildPrisma();
      prisma.processedEvent.create.mockRejectedValue(new Error("plain error, no code"));
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("plain error, no code");
    });
  });
});
