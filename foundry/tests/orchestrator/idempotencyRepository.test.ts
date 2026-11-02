import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new IdempotencyRepository(prisma as never);
  });

  it("returns true and records the event on first sight", async () => {
    prisma.processedEvent.create.mockResolvedValue({});
    const result = await repo.tryMarkProcessed("linear", "evt-1");
    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
  });

  it("returns false on a unique-constraint violation (duplicate event)", async () => {
    const dup = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(dup);
    const result = await repo.tryMarkProcessed("linear", "evt-1");
    expect(result).toBe(false);
  });

  it("rethrows errors that are not duplicate-key violations", async () => {
    const other = Object.assign(new Error("connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(other);
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection lost");
  });

  it("rethrows non-Error rejection values untouched", async () => {
    prisma.processedEvent.create.mockRejectedValue("boom");
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("boom");
  });
});
