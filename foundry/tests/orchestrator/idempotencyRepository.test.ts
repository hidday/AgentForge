import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrismaMock() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new IdempotencyRepository(prisma);
  });

  it("returns true when the event is recorded for the first time", async () => {
    prisma.processedEvent.create.mockResolvedValue({ id: "pe-1" });
    const result = await repo.tryMarkProcessed("linear", "evt-1");
    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
  });

  it("returns false when the event was already processed (unique constraint violation P2002)", async () => {
    const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(conflict);
    const result = await repo.tryMarkProcessed("linear", "evt-1");
    expect(result).toBe(false);
  });

  it("rethrows errors that are not a P2002 unique-constraint violation", async () => {
    const dbError = Object.assign(new Error("connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(dbError);
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection lost");
  });

  it("rethrows errors that are not Error instances", async () => {
    prisma.processedEvent.create.mockRejectedValue("totally unexpected");
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("totally unexpected");
  });
});
