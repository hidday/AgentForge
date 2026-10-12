import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma(createImpl: () => unknown) {
  return {
    processedEvent: {
      create: vi.fn(createImpl),
    },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event when it is newly seen", async () => {
      const prisma = makePrisma(() => Promise.resolve({ id: "pe-1" }));
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(true);
      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
    });

    it("returns false when prisma throws a P2002 unique-constraint error (duplicate)", async () => {
      const duplicateError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const prisma = makePrisma(() => Promise.reject(duplicateError));
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not P2002 unique-constraint violations", async () => {
      const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
      const prisma = makePrisma(() => Promise.reject(otherError));
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
    });

    it("rethrows non-Error throwables as-is", async () => {
      const prisma = makePrisma(() => Promise.reject("boom"));
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("boom");
    });

    it("rethrows an Error without a code property", async () => {
      const plainError = new Error("something else broke");
      const prisma = makePrisma(() => Promise.reject(plainError));
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("something else broke");
    });
  });
});
