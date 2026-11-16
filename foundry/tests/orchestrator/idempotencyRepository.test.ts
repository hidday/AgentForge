import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new IdempotencyRepository(prisma);
  });

  describe("tryMarkProcessed", () => {
    it("returns true when the event is newly recorded", async () => {
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "pe-1",
        source: "linear",
        externalEventId: "ext-1",
      });

      const result = await repo.tryMarkProcessed("linear", "ext-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "ext-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when create throws a P2002 unique-constraint violation", async () => {
      const dupError = Object.assign(new Error("dup"), { code: "P2002" });
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(dupError);

      const result = await repo.tryMarkProcessed("linear", "ext-1");

      expect(result).toBe(false);
    });

    it("rethrows any other error", async () => {
      const otherError = Object.assign(new Error("connection lost"), { code: "P1001" });
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(otherError);

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toThrow("connection lost");
    });

    it("rethrows a plain Error without a code property", async () => {
      const plainError = new Error("boom");
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(plainError);

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toThrow("boom");
    });

    it("rethrows non-Error thrown values", async () => {
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue("not an error");

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toBe("not an error");
    });
  });
});
