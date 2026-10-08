import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository", () => {
  it("tryMarkProcessed() returns true when the event is recorded for the first time", async () => {
    const prisma = makePrisma();
    prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("tryMarkProcessed() returns false on a unique constraint violation (P2002), indicating a duplicate", async () => {
    const prisma = makePrisma();
    const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(conflict);
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("tryMarkProcessed() rethrows errors that are not a P2002 unique violation", async () => {
    const prisma = makePrisma();
    const dbError = new Error("connection reset");
    prisma.processedEvent.create.mockRejectedValue(dbError);
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection reset");
  });

  it("tryMarkProcessed() rethrows non-Error throwables unchanged", async () => {
    const prisma = makePrisma();
    prisma.processedEvent.create.mockRejectedValue("not an error object");
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("not an error object");
  });
});
