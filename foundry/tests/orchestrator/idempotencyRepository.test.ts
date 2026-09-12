import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma() {
  const processedEvent = {
    create: vi.fn(),
  };
  return { processedEvent } as unknown as PrismaClient & { processedEvent: typeof processedEvent };
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  it("returns true when the event is recorded for the first time", async () => {
    const prisma = makePrisma();
    prisma.processedEvent.create.mockResolvedValue({
      id: "pe-1",
      source: "linear",
      externalEventId: "ext-1",
    });
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "ext-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "ext-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false on a unique-constraint violation (P2002), signalling a duplicate", async () => {
    const prisma = makePrisma();
    const conflictError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(conflictError);
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "ext-1");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not a P2002 uniqueness violation", async () => {
    const prisma = makePrisma();
    const otherError = Object.assign(new Error("connection reset"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(otherError);
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toThrow("connection reset");
  });

  it("rethrows non-Error rejections untouched", async () => {
    const prisma = makePrisma();
    prisma.processedEvent.create.mockRejectedValue("not-an-error");
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "ext-1")).rejects.toBe("not-an-error");
  });
});
