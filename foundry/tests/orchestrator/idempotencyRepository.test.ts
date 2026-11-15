import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("IdempotencyRepository", () => {
  it("tryMarkProcessed() returns true when the event is newly recorded", async () => {
    const prisma = makePrisma();
    prisma.processedEvent.create.mockResolvedValue({});
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("tryMarkProcessed() returns false on a Prisma unique-constraint violation (P2002)", async () => {
    const prisma = makePrisma();
    const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(conflict);
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "evt-dup");

    expect(result).toBe(false);
  });

  it("tryMarkProcessed() rethrows errors that are not P2002 conflicts", async () => {
    const prisma = makePrisma();
    const other = Object.assign(new Error("connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(other);
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-2")).rejects.toThrow("connection lost");
  });

  it("tryMarkProcessed() rethrows non-Error throws untouched", async () => {
    const prisma = makePrisma();
    prisma.processedEvent.create.mockRejectedValue("boom");
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-3")).rejects.toBe("boom");
  });
});
