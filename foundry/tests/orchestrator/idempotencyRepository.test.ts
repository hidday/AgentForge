import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

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
    repo = new IdempotencyRepository(prisma as unknown as PrismaClient);
  });

  it("returns true and records the event when it has not been seen before", async () => {
    prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false when create rejects with a P2002 unique-constraint error (duplicate)", async () => {
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(err);

    const result = await repo.tryMarkProcessed("linear", "evt-dup");

    expect(result).toBe(false);
  });

  it("rethrows when create rejects with an unrelated error", async () => {
    const err = Object.assign(new Error("connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(err);

    await expect(repo.tryMarkProcessed("linear", "evt-2")).rejects.toThrow("connection lost");
  });

  it("rethrows when create rejects with a plain error lacking a code property", async () => {
    const err = new Error("boom");
    prisma.processedEvent.create.mockRejectedValue(err);

    await expect(repo.tryMarkProcessed("linear", "evt-3")).rejects.toThrow("boom");
  });
});
