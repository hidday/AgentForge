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

    it("returns false when a unique constraint violation (P2002) indicates a duplicate", async () => {
      const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const result = await repo.tryMarkProcessed("linear", "ext-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not P2002 unique-constraint violations", async () => {
      const error = Object.assign(new Error("connection lost"), { code: "P1001" });
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toThrow("connection lost");
    });

    it("rethrows non-Error, non-coded rejections as-is", async () => {
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue("plain string failure");

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toBe("plain string failure");
    });

    it("rethrows Error instances that lack a code property", async () => {
      const error = new Error("no code here");
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toThrow("no code here");
    });
  });
});
