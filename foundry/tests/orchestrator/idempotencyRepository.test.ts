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
    prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false when the event was already processed (Prisma unique constraint P2002)", async () => {
    const prisma = buildPrismaMock();
    const conflictError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(conflictError);
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-dup");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not the P2002 duplicate-key error", async () => {
    const prisma = buildPrismaMock();
    const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(otherError);
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-2")).rejects.toThrow("Connection lost");
  });

  it("rethrows non-Error rejections unchanged", async () => {
    const prisma = buildPrismaMock();
    prisma.processedEvent.create.mockRejectedValue("plain string failure");
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-3")).rejects.toBe("plain string failure");
  });
});
