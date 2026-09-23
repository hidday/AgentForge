import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function buildPrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  };
}

describe("IdempotencyRepository", () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = buildPrisma();
    repo = new IdempotencyRepository(prisma as unknown as PrismaClient);
  });

  it("returns true when the event is newly recorded", async () => {
    prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });
    const result = await repo.tryMarkProcessed("linear", "evt-1");
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false when a unique constraint violation (P2002) is thrown", async () => {
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(err);
    const result = await repo.tryMarkProcessed("linear", "evt-1");
    expect(result).toBe(false);
  });

  it("rethrows errors that are not a P2002 unique constraint violation", async () => {
    const err = Object.assign(new Error("Connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(err);
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
  });

  it("rethrows non-Error rejections unchanged", async () => {
    prisma.processedEvent.create.mockRejectedValue("boom");
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("boom");
  });

  it("rethrows Error instances that lack a code property", async () => {
    prisma.processedEvent.create.mockRejectedValue(new Error("no code here"));
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("no code here");
  });
});
