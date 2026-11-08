import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    processedEvent: {
      create: vi.fn(),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it("returns true and records the event when it has not been seen before", async () => {
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "pe-1",
      source: "linear",
      externalEventId: "evt-1",
    });
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
  });

  it("returns false on a P2002 unique constraint violation (duplicate event)", async () => {
    const duplicateError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(duplicateError);
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not P2002 violations", async () => {
    const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(otherError);
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
  });

  it("rethrows errors that are Error instances without a code property", async () => {
    const plainError = new Error("boom");
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(plainError);
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("boom");
  });

  it("rethrows non-Error thrown values unchanged", async () => {
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue("a string failure");
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("a string failure");
  });
});
