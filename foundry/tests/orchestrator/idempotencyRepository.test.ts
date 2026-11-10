import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeMockPrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event when it has not been seen before", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.processedEvent.create.mockResolvedValue({
        id: "processed-1",
        source: "linear",
        externalEventId: "evt-1",
      });

      const repo = new IdempotencyRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(true);
      expect(mockPrisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
    });

    it("returns false on a unique-constraint violation (P2002), treating it as a duplicate", async () => {
      const mockPrisma = makeMockPrisma();
      const duplicateError = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      mockPrisma.processedEvent.create.mockRejectedValue(duplicateError);

      const repo = new IdempotencyRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are Error instances but lack a code property", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.processedEvent.create.mockRejectedValue(new Error("connection reset"));

      const repo = new IdempotencyRepository(mockPrisma as unknown as PrismaClient);
      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection reset");
    });

    it("rethrows errors that are Error instances with a different error code", async () => {
      const mockPrisma = makeMockPrisma();
      const otherError = Object.assign(new Error("Foreign key constraint failed"), {
        code: "P2003",
      });
      mockPrisma.processedEvent.create.mockRejectedValue(otherError);

      const repo = new IdempotencyRepository(mockPrisma as unknown as PrismaClient);
      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow(
        "Foreign key constraint failed",
      );
    });

    it("rethrows non-Error thrown values unchanged", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.processedEvent.create.mockRejectedValue("a plain string failure");

      const repo = new IdempotencyRepository(mockPrisma as unknown as PrismaClient);
      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(
        "a plain string failure",
      );
    });
  });
});
