import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildPrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  it("returns true and creates a row when the event has not been seen before", async () => {
    const prisma = buildPrisma();
    prisma.processedEvent.create.mockResolvedValue({
      id: "pe-1",
      source: "linear",
      externalEventId: "evt-1",
      processedAt: new Date(),
    });

    const repo = new IdempotencyRepository(prisma as never);
    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledOnce();
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
  });

  it("returns false without throwing when the create fails with a P2002 unique constraint error", async () => {
    const prisma = buildPrisma();
    const conflictError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    prisma.processedEvent.create.mockRejectedValue(conflictError);

    const repo = new IdempotencyRepository(prisma as never);
    const result = await repo.tryMarkProcessed("github", "evt-dup");

    expect(result).toBe(false);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "github", externalEventId: "evt-dup" },
    });
  });

  it("re-throws errors that are Error instances but not P2002", async () => {
    const prisma = buildPrisma();
    const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(otherError);

    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-2")).rejects.toBe(otherError);
  });

  it("re-throws errors that are Error instances without a code property", async () => {
    const prisma = buildPrisma();
    const plainError = new Error("Something unexpected");
    prisma.processedEvent.create.mockRejectedValue(plainError);

    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-3")).rejects.toBe(plainError);
  });

  it("re-throws non-Error rejection values as-is", async () => {
    const prisma = buildPrisma();
    prisma.processedEvent.create.mockRejectedValue("plain string failure");

    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-4")).rejects.toBe("plain string failure");
  });
});
