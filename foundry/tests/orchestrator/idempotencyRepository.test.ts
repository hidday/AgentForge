import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma(createImpl: () => unknown) {
  return {
    processedEvent: {
      create: vi.fn(createImpl),
    },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event when creation succeeds (first time seen)", async () => {
      const create = vi.fn().mockResolvedValue({ id: "pe-1" });
      const prisma = { processedEvent: { create } } as unknown as PrismaClient;

      const repo = new IdempotencyRepository(prisma);
      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when create throws a P2002 unique-constraint error (duplicate)", async () => {
      const collision = Object.assign(new Error("unique constraint"), { code: "P2002" });
      const prisma = makePrisma(() => {
        throw collision;
      });

      const repo = new IdempotencyRepository(prisma);
      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows an Error with a different code", async () => {
      const otherError = Object.assign(new Error("connection lost"), { code: "P1001" });
      const prisma = makePrisma(() => {
        throw otherError;
      });

      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection lost");
    });

    it("rethrows an Error with no code property", async () => {
      const plainError = new Error("something else went wrong");
      const prisma = makePrisma(() => {
        throw plainError;
      });

      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow(
        "something else went wrong",
      );
    });

    it("rethrows a non-Error throw value unchanged", async () => {
      const prisma = makePrisma(() => {
        throw "not an error object";
      });

      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("not an error object");
    });
  });
});
