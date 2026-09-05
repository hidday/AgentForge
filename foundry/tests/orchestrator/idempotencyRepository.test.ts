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

  it("returns true and records the event when it is new", async () => {
    prisma.processedEvent.create.mockResolvedValue({});
    const result = await repo.tryMarkProcessed("linear", "evt-1");
    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
  });

  it("returns false on a P2002 unique constraint violation (duplicate event)", async () => {
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(err);
    const result = await repo.tryMarkProcessed("linear", "evt-1");
    expect(result).toBe(false);
  });

  it("rethrows non-P2002 errors", async () => {
    const err = Object.assign(new Error("connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(err);
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection lost");
  });

  it("rethrows errors that are Error instances without a code property", async () => {
    prisma.processedEvent.create.mockRejectedValue(new Error("plain failure"));
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("plain failure");
  });

  it("rethrows non-Error thrown values", async () => {
    prisma.processedEvent.create.mockRejectedValue("string failure");
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("string failure");
  });
});
