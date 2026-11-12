import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makeFakePrisma() {
  const processedEvent = {
    create: vi.fn(),
  };
  return { processedEvent };
}

function prismaUniqueConstraintError(): Error & { code: string } {
  const err = new Error("Unique constraint failed") as Error & { code: string };
  err.code = "P2002";
  return err;
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and creates the record when the event is new", async () => {
      const prisma = makeFakePrisma();
      prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when the event was already processed (unique constraint, P2002)", async () => {
      const prisma = makeFakePrisma();
      prisma.processedEvent.create.mockRejectedValue(prismaUniqueConstraintError());
      const repo = new IdempotencyRepository(prisma as never);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows an Error with a different code", async () => {
      const prisma = makeFakePrisma();
      const err = new Error("connection lost") as Error & { code: string };
      err.code = "P1001";
      prisma.processedEvent.create.mockRejectedValue(err);
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection lost");
    });

    it("rethrows an Error with no code property", async () => {
      const prisma = makeFakePrisma();
      const err = new Error("boom");
      prisma.processedEvent.create.mockRejectedValue(err);
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("boom");
    });

    it("rethrows a non-Error rejection as-is", async () => {
      const prisma = makeFakePrisma();
      prisma.processedEvent.create.mockRejectedValue("not an error object");
      const repo = new IdempotencyRepository(prisma as never);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("not an error object");
    });
  });
});
