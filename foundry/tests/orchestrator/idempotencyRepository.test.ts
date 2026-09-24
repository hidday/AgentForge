import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrismaMock() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new IdempotencyRepository(prisma);
  });

  it("returns true and records the event on first sight", async () => {
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "pe-1",
      source: "linear",
      externalEventId: "evt-1",
      createdAt: new Date(),
    });

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false when the event is a duplicate (Prisma unique constraint P2002)", async () => {
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows an Error with a different Prisma error code", async () => {
    const err = Object.assign(new Error("Connection lost"), { code: "P1001" });
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
  });

  it("rethrows an Error with no code property at all", async () => {
    const err = new Error("Unexpected failure");
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Unexpected failure");
  });

  it("rethrows a non-Error rejection as-is", async () => {
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue("boom");

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("boom");
  });
});
