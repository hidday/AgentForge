import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma() {
  return { processedEvent: { create: vi.fn() } };
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  it("returns true when the event is recorded for the first time", async () => {
    const prisma = makePrisma();
    prisma.processedEvent.create.mockResolvedValue({});
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
  });

  it("returns false on a unique constraint violation (P2002), indicating a duplicate", async () => {
    const prisma = makePrisma();
    const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(error);
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not a P2002 unique constraint violation", async () => {
    const prisma = makePrisma();
    const error = Object.assign(new Error("Connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(error);
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
  });

  it("rethrows a non-Error rejection as-is", async () => {
    const prisma = makePrisma();
    prisma.processedEvent.create.mockRejectedValue("boom");
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("boom");
  });
});
