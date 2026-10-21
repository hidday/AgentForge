import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient;
}

class PrismaKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("Unique constraint failed");
    this.code = code;
  }
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event when seen for the first time", async () => {
      const prisma = makePrisma();
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("github", "evt-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "github", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when the event is a duplicate (Prisma P2002 unique violation)", async () => {
      const prisma = makePrisma();
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new PrismaKnownRequestError("P2002"),
      );
      const repo = new IdempotencyRepository(prisma);

      const result = await repo.tryMarkProcessed("github", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not a P2002 unique violation", async () => {
      const prisma = makePrisma();
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new PrismaKnownRequestError("P2003"),
      );
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("github", "evt-1")).rejects.toThrow("Unique constraint failed");
    });

    it("rethrows non-Error rejections (e.g. a connection failure without a .code)", async () => {
      const prisma = makePrisma();
      (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue("connection refused");
      const repo = new IdempotencyRepository(prisma);

      await expect(repo.tryMarkProcessed("github", "evt-1")).rejects.toBe("connection refused");
    });
  });
});
