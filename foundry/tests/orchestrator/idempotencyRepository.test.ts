import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function buildPrisma() {
  const processedEvent = {
    create: vi.fn(),
  };
  const prisma = { processedEvent } as unknown as PrismaClient;
  return { prisma, processedEvent };
}

describe("IdempotencyRepository", () => {
  let prisma: PrismaClient;
  let processedEvent: ReturnType<typeof buildPrisma>["processedEvent"];
  let repo: IdempotencyRepository;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    processedEvent = built.processedEvent;
    repo = new IdempotencyRepository(prisma);
  });

  describe("tryMarkProcessed", () => {
    it("creates a processedEvent record with source and externalEventId", async () => {
      processedEvent.create.mockResolvedValue({ id: "pe-1", source: "linear", externalEventId: "ext-1" });

      await repo.tryMarkProcessed("linear", "ext-1");

      expect(processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "ext-1" },
      });
    });

    it("returns true when the event is recorded for the first time", async () => {
      processedEvent.create.mockResolvedValue({ id: "pe-1", source: "linear", externalEventId: "ext-1" });

      const result = await repo.tryMarkProcessed("linear", "ext-1");

      expect(result).toBe(true);
    });

    it("returns false when the create fails with a Prisma unique-constraint error (P2002)", async () => {
      const uniqueViolation = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      processedEvent.create.mockRejectedValue(uniqueViolation);

      const result = await repo.tryMarkProcessed("linear", "ext-1");

      expect(result).toBe(false);
    });

    it("rethrows errors that are not P2002 unique-constraint violations", async () => {
      const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
      processedEvent.create.mockRejectedValue(otherError);

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toThrow("Connection lost");
    });

    it("rethrows errors that are Error instances without a code property", async () => {
      processedEvent.create.mockRejectedValue(new Error("boom"));

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toThrow("boom");
    });

    it("rethrows non-Error values thrown by the Prisma client", async () => {
      processedEvent.create.mockRejectedValue("not an error object");

      await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toBe("not an error object");
    });
  });
});
