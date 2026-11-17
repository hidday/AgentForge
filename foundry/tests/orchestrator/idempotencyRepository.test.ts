import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  it("returns true and records the event when it has not been seen before", async () => {
    const prisma = makePrisma();
    prisma.processedEvent.create.mockResolvedValue({});
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false on a unique-constraint violation (P2002), treating it as a duplicate", async () => {
    const prisma = makePrisma();
    const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(conflict);
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows an Error that has a different error code", async () => {
    const prisma = makePrisma();
    const other = Object.assign(new Error("connection refused"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(other);
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(other);
  });

  it("rethrows an Error that has no code property at all", async () => {
    const prisma = makePrisma();
    const plain = new Error("boom");
    prisma.processedEvent.create.mockRejectedValue(plain);
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(plain);
  });

  it("rethrows a thrown value that is not an Error instance", async () => {
    const prisma = makePrisma();
    const nonError = { code: "P2002" };
    prisma.processedEvent.create.mockRejectedValue(nonError);
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(nonError);
  });
});
