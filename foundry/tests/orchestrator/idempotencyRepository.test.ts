import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new IdempotencyRepository(prisma);
  });

  it("returns true and records the event when it is seen for the first time", async () => {
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false on a unique-constraint violation (duplicate event)", async () => {
    const duplicateError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(duplicateError);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not the P2002 duplicate-key error", async () => {
    const otherError = Object.assign(new Error("connection reset"), { code: "P1001" });
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(otherError);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection reset");
  });

  it("rethrows errors that have no 'code' property at all", async () => {
    const plainError = new Error("boom");
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue(plainError);

    await expect(repo.tryMarkProcessed("github", "evt-2")).rejects.toThrow("boom");
  });

  it("rethrows non-Error rejections unchanged", async () => {
    (prisma.processedEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue("not-an-error");

    await expect(repo.tryMarkProcessed("github", "evt-3")).rejects.toBe("not-an-error");
  });
});
