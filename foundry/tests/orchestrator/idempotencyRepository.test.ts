import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

describe("IdempotencyRepository", () => {
  let prisma: { processedEvent: { create: ReturnType<typeof vi.fn> } };
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = { processedEvent: { create: vi.fn() } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repo = new IdempotencyRepository(prisma as any);
  });

  it("returns true when the event is recorded for the first time", async () => {
    prisma.processedEvent.create.mockResolvedValue({});

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false on a unique constraint violation (duplicate event)", async () => {
    const dup = Object.assign(new Error("duplicate"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(dup);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not unique constraint violations", async () => {
    const other = Object.assign(new Error("connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(other);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection lost");
  });

  it("rethrows non-Error rejections unchanged", async () => {
    prisma.processedEvent.create.mockRejectedValue("not an error");

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("not an error");
  });
});
