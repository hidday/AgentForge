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
    it("returns true and records the event when it is seen for the first time", async () => {
      const create = vi.fn().mockResolvedValue({ id: "pe-1" });
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when prisma raises a unique constraint violation (P2002)", async () => {
      const duplicateError = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      const create = vi.fn().mockRejectedValue(duplicateError);
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not a P2002 unique constraint violation", async () => {
      const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
      const create = vi.fn().mockRejectedValue(otherError);
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
    });

    it("rethrows non-Error throwables unchanged", async () => {
      const create = vi.fn().mockRejectedValue("boom");
      const prisma = makePrisma({ create });
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("boom");
    });
  });
});
