import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    processedEvent: {
      create: vi.fn(),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event on first sight", async () => {
      const create = vi.fn().mockResolvedValue({ id: "pe-1" });
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when the event is a duplicate (Prisma P2002 unique constraint error)", async () => {
      const duplicateError = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      const create = vi.fn().mockRejectedValue(duplicateError);
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-1");
      expect(result).toBe(false);
    });

    it("rethrows errors that are not P2002 duplicate errors", async () => {
      const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
      const create = vi.fn().mockRejectedValue(otherError);
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
    });

    it("rethrows non-Error rejection values as-is", async () => {
      const create = vi.fn().mockRejectedValue("plain string failure");
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("plain string failure");
    });

    it("rethrows an Error without a code property", async () => {
      const errorWithoutCode = new Error("generic failure");
      const create = vi.fn().mockRejectedValue(errorWithoutCode);
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("generic failure");
    });
  });
});
