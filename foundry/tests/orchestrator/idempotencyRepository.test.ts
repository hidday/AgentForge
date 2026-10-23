import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

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
    it("returns true and records the event when seen for the first time", async () => {
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
      const duplicateError = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        duplicateError,
      );

      const result = await repo.tryMarkProcessed("linear", "ext-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not P2002 unique-constraint violations", async () => {
      const otherError = Object.assign(new Error("connection lost"), { code: "P1001" });
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(otherError);

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toThrow("connection lost");
    });

    it("rethrows Error instances that carry no error code", async () => {
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("generic failure"),
      );

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toThrow("generic failure");
    });

    it("rethrows non-Error rejection values unchanged", async () => {
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        "a raw string rejection",
      );

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toBe(
        "a raw string rejection",
      );
    });
  });
});
