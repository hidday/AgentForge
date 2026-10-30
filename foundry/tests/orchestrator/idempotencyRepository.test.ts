import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrismaMock() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient & {
    processedEvent: { create: ReturnType<typeof vi.fn> };
  };
}

describe("IdempotencyRepository", () => {
  describe("tryMarkProcessed", () => {
    it("returns true and records the event when it has not been seen before", async () => {
      const prisma = makePrismaMock();
      prisma.processedEvent.create.mockResolvedValue({
        id: "pe-1",
        source: "github",
        externalEventId: "evt-1",
        createdAt: new Date(),
      });

      const repo = new IdempotencyRepository(prisma);
      const result = await repo.tryMarkProcessed("github", "evt-1");

      expect(result).toBe(true);
      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "github", externalEventId: "evt-1" },
      });
    });

    it("returns false when the event was already processed (unique constraint violation, P2002)", async () => {
      const prisma = makePrismaMock();
      const duplicateError = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      prisma.processedEvent.create.mockRejectedValue(duplicateError);

      const repo = new IdempotencyRepository(prisma);
      const result = await repo.tryMarkProcessed("github", "evt-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not a P2002 unique constraint violation", async () => {
      const prisma = makePrismaMock();
      const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
      prisma.processedEvent.create.mockRejectedValue(otherError);

      const repo = new IdempotencyRepository(prisma);
      await expect(repo.tryMarkProcessed("github", "evt-1")).rejects.toThrow("Connection lost");
    });

    it("rethrows a non-Error rejection (no `code` field to check) unchanged", async () => {
      const prisma = makePrismaMock();
      prisma.processedEvent.create.mockRejectedValue("not an error object");

      const repo = new IdempotencyRepository(prisma);
      await expect(repo.tryMarkProcessed("github", "evt-1")).rejects.toBe(
        "not an error object",
      );
    });

    it("rethrows an Error without a `code` property", async () => {
      const prisma = makePrismaMock();
      prisma.processedEvent.create.mockRejectedValue(new Error("plain error, no code"));

      const repo = new IdempotencyRepository(prisma);
      await expect(repo.tryMarkProcessed("github", "evt-1")).rejects.toThrow(
        "plain error, no code",
      );
    });
  });
});
