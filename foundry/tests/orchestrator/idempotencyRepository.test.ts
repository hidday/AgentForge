import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma() {
  const processedEvent = {
    create: vi.fn(),
  };
  return { processedEvent } as unknown as PrismaClient & { processedEvent: typeof processedEvent };
}

describe("IdempotencyRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new IdempotencyRepository(prisma);
  });

  it("returns true and records the key when the event is new", async () => {
    prisma.processedEvent.create.mockResolvedValue({
      id: "1",
      source: "linear",
      externalEventId: "evt-1",
    });

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
  });

  it("returns false when the event was already processed (unique constraint violation P2002)", async () => {
    const duplicateError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    prisma.processedEvent.create.mockRejectedValue(duplicateError);

    const result = await repo.tryMarkProcessed("linear", "evt-dup");

    expect(result).toBe(false);
  });

  it("re-throws errors that are not the P2002 duplicate-key error", async () => {
    const otherError = Object.assign(new Error("Connection refused"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(otherError);

    await expect(repo.tryMarkProcessed("linear", "evt-x")).rejects.toThrow("Connection refused");
  });

  it("re-throws a plain Error without a code property", async () => {
    prisma.processedEvent.create.mockRejectedValue(new Error("boom"));

    await expect(repo.tryMarkProcessed("linear", "evt-y")).rejects.toThrow("boom");
  });

  it("re-throws non-Error thrown values as-is", async () => {
    prisma.processedEvent.create.mockRejectedValue("not-an-error");

    await expect(repo.tryMarkProcessed("linear", "evt-z")).rejects.toBe("not-an-error");
  });
});
