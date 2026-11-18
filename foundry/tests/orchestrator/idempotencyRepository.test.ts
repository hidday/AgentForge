import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    processedEvent: {
      create: vi.fn(),
      ...overrides,
    },
  };
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true when the event is recorded for the first time", async () => {
      const prisma = buildPrisma({ create: vi.fn().mockResolvedValue({}) });
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false on a unique-constraint violation (P2002), indicating a duplicate", async () => {
      const duplicateError = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      const prisma = buildPrisma({ create: vi.fn().mockRejectedValue(duplicateError) });
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not P2002 unique-constraint violations", async () => {
      const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
      const prisma = buildPrisma({ create: vi.fn().mockRejectedValue(otherError) });
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
    });

    it("rethrows a thrown value that is not an Error instance", async () => {
      const prisma = buildPrisma({ create: vi.fn().mockRejectedValue("plain string failure") });
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("plain string failure");
    });

    it("rethrows an Error without a code property", async () => {
      const prisma = buildPrisma({ create: vi.fn().mockRejectedValue(new Error("no code here")) });
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("no code here");
    });
  });
});
