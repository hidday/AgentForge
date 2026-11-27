import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildRepo() {
  const prisma = {
    processedEvent: {
      create: vi.fn(),
    },
  };
  const repo = new IdempotencyRepository(prisma as never);
  return { repo, prisma };
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  it("returns true and records the event on first sight", async () => {
    const { repo, prisma } = buildRepo();
    prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false (does not throw) on a unique-constraint violation (P2002)", async () => {
    const { repo, prisma } = buildRepo();
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(err);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows an Error that has a different error code", async () => {
    const { repo, prisma } = buildRepo();
    const err = Object.assign(new Error("Connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(err);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
  });

  it("rethrows an Error that has no error code at all", async () => {
    const { repo, prisma } = buildRepo();
    prisma.processedEvent.create.mockRejectedValue(new Error("boom"));

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("boom");
  });

  it("rethrows a thrown value that is not an Error instance", async () => {
    const { repo, prisma } = buildRepo();
    prisma.processedEvent.create.mockRejectedValue("not-an-error");

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("not-an-error");
  });
});
