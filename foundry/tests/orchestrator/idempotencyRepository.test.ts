import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new IdempotencyRepository(prisma as never);
  });

  describe("tryMarkProcessed", () => {
    it("returns true and creates the row when the event is new", async () => {
      prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });

      const result = await repo.tryMarkProcessed("linear", "evt-1");

      expect(prisma.processedEvent.create).toHaveBeenCalledWith({
        data: { source: "linear", externalEventId: "evt-1" },
      });
      expect(result).toBe(true);
    });

    it("returns false when prisma throws a unique constraint violation (P2002)", async () => {
      const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      prisma.processedEvent.create.mockRejectedValue(err);

      const result = await repo.tryMarkProcessed("linear", "evt-dup");

      expect(result).toBe(false);
    });

    it("re-throws errors that are not P2002 violations", async () => {
      const err = Object.assign(new Error("connection lost"), { code: "P1001" });
      prisma.processedEvent.create.mockRejectedValue(err);

      await expect(repo.tryMarkProcessed("linear", "evt-x")).rejects.toThrow("connection lost");
    });

    it("re-throws non-Error values thrown without a code", async () => {
      prisma.processedEvent.create.mockRejectedValue("some string failure");

      await expect(repo.tryMarkProcessed("linear", "evt-y")).rejects.toBe("some string failure");
    });

    it("re-throws a plain Error with no code property", async () => {
      prisma.processedEvent.create.mockRejectedValue(new Error("generic failure"));

      await expect(repo.tryMarkProcessed("linear", "evt-z")).rejects.toThrow("generic failure");
    });
  });
});
