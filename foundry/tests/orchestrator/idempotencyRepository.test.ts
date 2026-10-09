import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrismaMock() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event when it has not been seen before", async () => {
      const prisma = makePrismaMock();
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "pe-1",
        source: "linear",
        externalEventId: "evt-1",
      });
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false on a unique-constraint violation (duplicate event)", async () => {
      const prisma = makePrismaMock();
      const duplicateError = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(duplicateError);
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not a P2002 unique-constraint violation", async () => {
      const prisma = makePrismaMock();
      const otherError = Object.assign(new Error("connection lost"), { code: "P1001" });
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(otherError);
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection lost");
    });

    it("rethrows non-Error throwables untouched", async () => {
      const prisma = makePrismaMock();
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue("boom");
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("boom");
    });
  });
});
