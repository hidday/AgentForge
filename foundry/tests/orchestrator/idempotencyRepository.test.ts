import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makeMockPrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository", () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    mockPrisma = makeMockPrisma();
    repo = new IdempotencyRepository(mockPrisma as never);
  });

  it("returns true and records the event when it has not been seen before", async () => {
    mockPrisma.processedEvent.create.mockResolvedValue({
      id: "p1",
      source: "linear",
      externalEventId: "evt-1",
    });

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(mockPrisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false when prisma raises a unique constraint violation (P2002)", async () => {
    const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    mockPrisma.processedEvent.create.mockRejectedValue(error);

    const result = await repo.tryMarkProcessed("linear", "evt-dup");

    expect(result).toBe(false);
  });

  it("rethrows an Error that lacks a code property", async () => {
    const error = new Error("connection reset");
    mockPrisma.processedEvent.create.mockRejectedValue(error);

    await expect(repo.tryMarkProcessed("linear", "evt-2")).rejects.toThrow("connection reset");
  });

  it("rethrows an Error whose code is not P2002", async () => {
    const error = Object.assign(new Error("other db error"), { code: "P9999" });
    mockPrisma.processedEvent.create.mockRejectedValue(error);

    await expect(repo.tryMarkProcessed("linear", "evt-3")).rejects.toMatchObject({
      code: "P9999",
    });
  });

  it("rethrows a non-Error rejection as-is", async () => {
    mockPrisma.processedEvent.create.mockRejectedValue("boom");

    await expect(repo.tryMarkProcessed("linear", "evt-4")).rejects.toBe("boom");
  });
});
