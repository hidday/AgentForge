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
  it("returns true and creates the record when the event is seen for the first time", async () => {
    const prisma = buildPrisma();
    prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false (does not throw) on a unique-constraint violation (P2002)", async () => {
    const prisma = buildPrisma();
    const dupError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(dupError);
    const repo = new IdempotencyRepository(prisma as never);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not a P2002 unique-constraint violation", async () => {
    const prisma = buildPrisma();
    const otherError = Object.assign(new Error("Connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(otherError);
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
  });

  it("rethrows a plain Error without a code property", async () => {
    const prisma = buildPrisma();
    prisma.processedEvent.create.mockRejectedValue(new Error("boom"));
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("github", "evt-2")).rejects.toThrow("boom");
  });

  it("rethrows a non-Error rejection value unchanged", async () => {
    const prisma = buildPrisma();
    prisma.processedEvent.create.mockRejectedValue("some string rejection");
    const repo = new IdempotencyRepository(prisma as never);

    await expect(repo.tryMarkProcessed("github", "evt-3")).rejects.toBe("some string rejection");
  });
});
