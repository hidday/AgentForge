import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrismaMock() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and creates a record when the event is new", async () => {
      const prisma = makePrismaMock();
      prisma.processedEvent.create.mockResolvedValue({
        id: "evt-1",
        source: "linear",
        externalEventId: "ext-1",
      });
      const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

      const result = await repo.tryMarkProcessed("linear", "ext-1");

      expect(result).toBe(true);
      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "ext-1" },
      });
      expect(prisma.processedEvent.create).toHaveBeenCalledTimes(1);
    });

    it("returns false when a unique-constraint (P2002) error is thrown", async () => {
      const prisma = makePrismaMock();
      const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      prisma.processedEvent.create.mockRejectedValue(err);
      const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

      const result = await repo.tryMarkProcessed("linear", "ext-dup");

      expect(result).toBe(false);
      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "ext-dup" },
      });
    });

    it("rethrows an Error that has a code other than P2002", async () => {
      const prisma = makePrismaMock();
      const err = Object.assign(new Error("Some other DB error"), { code: "P9999" });
      prisma.processedEvent.create.mockRejectedValue(err);
      const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

      await expect(repo.tryMarkProcessed("linear", "ext-2")).rejects.toBe(err);
    });

    it("rethrows an Error that has no code property at all", async () => {
      const prisma = makePrismaMock();
      const err = new Error("Network failure");
      prisma.processedEvent.create.mockRejectedValue(err);
      const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

      await expect(repo.tryMarkProcessed("linear", "ext-3")).rejects.toBe(err);
    });

    it("rethrows a non-Error rejection even if it carries a P2002-like code", async () => {
      const prisma = makePrismaMock();
      const err = { code: "P2002", message: "not a real Error instance" };
      prisma.processedEvent.create.mockRejectedValue(err);
      const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

      await expect(repo.tryMarkProcessed("linear", "ext-4")).rejects.toBe(err);
    });
  });
});
