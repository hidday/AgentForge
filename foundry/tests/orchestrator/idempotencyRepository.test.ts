import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient & {
    processedEvent: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

describe("IdempotencyRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new IdempotencyRepository(prisma);
  });

  it("returns true and creates a record the first time an event is seen", async () => {
    prisma.processedEvent.create.mockResolvedValue({
      id: "pe-1",
      source: "linear",
      externalEventId: "evt-1",
    });

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false (does not throw) when prisma raises a unique-constraint violation (P2002)", async () => {
    const duplicateError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    prisma.processedEvent.create.mockRejectedValue(duplicateError);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not a P2002 unique-constraint violation", async () => {
    const otherError = Object.assign(new Error("Connection lost"), {
      code: "P1001",
    });
    prisma.processedEvent.create.mockRejectedValue(otherError);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
  });

  it("rethrows a plain Error with no `code` property", async () => {
    prisma.processedEvent.create.mockRejectedValue(new Error("boom"));

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("boom");
  });

  it("rethrows a non-Error rejection value as-is", async () => {
    prisma.processedEvent.create.mockRejectedValue("some string rejection");

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("some string rejection");
  });
});
