import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and calls create with the given source/externalEventId on first sight", async () => {
      const create = vi.fn().mockResolvedValue({ id: "1" });
      const prisma = { processedEvent: { create } } as unknown as PrismaClient;
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-123");

      expect(result).toBe(true);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-123" },
      });
    });

    it("returns false when create throws a P2002 unique-constraint Error", async () => {
      const p2002Error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const create = vi.fn().mockRejectedValue(p2002Error);
      const prisma = { processedEvent: { create } } as unknown as PrismaClient;
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("linear", "evt-dup");

      expect(result).toBe(false);
    });

    it("re-throws a plain Error without a code property", async () => {
      const plainError = new Error("something else went wrong");
      const create = vi.fn().mockRejectedValue(plainError);
      const prisma = { processedEvent: { create } } as unknown as PrismaClient;
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-x")).rejects.toBe(plainError);
    });

    it("re-throws an Error whose code is not P2002", async () => {
      const otherError = Object.assign(new Error("foreign key violation"), { code: "P2003" });
      const create = vi.fn().mockRejectedValue(otherError);
      const prisma = { processedEvent: { create } } as unknown as PrismaClient;
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-y")).rejects.toBe(otherError);
    });

    it("re-throws a non-Error thrown value (e.g. a plain object with code P2002)", async () => {
      const nonError = { code: "P2002" };
      const create = vi.fn().mockRejectedValue(nonError);
      const prisma = { processedEvent: { create } } as unknown as PrismaClient;
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("linear", "evt-z")).rejects.toBe(nonError);
    });
  });
});
