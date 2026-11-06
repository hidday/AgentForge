import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildPrismaMock() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  it("returns true when the event is recorded for the first time", async () => {
    const prisma = buildPrismaMock();
    prisma.processedEvent.create.mockResolvedValue({
      source: "linear",
      externalEventId: "evt-1",
    });
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
  });

  it("returns false on a unique constraint violation (P2002), treating it as a duplicate", async () => {
    const prisma = buildPrismaMock();
    const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(conflict);
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not a P2002 conflict", async () => {
    const prisma = buildPrismaMock();
    const dbDown = Object.assign(new Error("connection refused"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(dbDown);
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow(
      "connection refused",
    );
  });

  it("rethrows non-Error throwables untouched", async () => {
    const prisma = buildPrismaMock();
    prisma.processedEvent.create.mockRejectedValue("some string failure");
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("some string failure");
  });
});
