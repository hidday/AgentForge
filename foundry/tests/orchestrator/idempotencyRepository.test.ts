import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makeMockPrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient;
}

class FakePrismaUniqueConstraintError extends Error {
  code = "P2002";
}

describe("IdempotencyRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new IdempotencyRepository(prisma);
  });

  it("returns true and records the event when it is seen for the first time", async () => {
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "pe-1",
      source: "linear",
      externalEventId: "evt-123",
    });

    const result = await repo.tryMarkProcessed("linear", "evt-123");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-123" },
    });
    expect(result).toBe(true);
  });

  it("returns false on a duplicate (Prisma unique constraint P2002) without throwing", async () => {
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new FakePrismaUniqueConstraintError("Unique constraint failed"),
    );

    const result = await repo.tryMarkProcessed("github", "evt-dup");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not a P2002 unique constraint violation", async () => {
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("connection reset"),
    );

    await expect(repo.tryMarkProcessed("github", "evt-err")).rejects.toThrow("connection reset");
  });

  it("rethrows non-Error throwables unchanged", async () => {
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue("boom");

    await expect(repo.tryMarkProcessed("github", "evt-str")).rejects.toBe("boom");
  });
});
