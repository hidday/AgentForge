import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrismaMock() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  it("returns true and records the event when it is newly seen", async () => {
    const prisma = makePrismaMock();
    prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });
    const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false when the unique constraint (P2002) is violated (duplicate event)", async () => {
    const prisma = makePrismaMock();
    const duplicateError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    prisma.processedEvent.create.mockRejectedValue(duplicateError);
    const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows an Error with a different error code", async () => {
    const prisma = makePrismaMock();
    const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(otherError);
    const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(otherError);
  });

  it("rethrows an Error that has no code property at all", async () => {
    const prisma = makePrismaMock();
    const plainError = new Error("something else broke");
    prisma.processedEvent.create.mockRejectedValue(plainError);
    const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(plainError);
  });

  it("rethrows a rejection that is not an Error instance at all", async () => {
    const prisma = makePrismaMock();
    prisma.processedEvent.create.mockRejectedValue({ code: "P2002" });
    const repo = new IdempotencyRepository(prisma as unknown as PrismaClient);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toEqual({ code: "P2002" });
  });
});
