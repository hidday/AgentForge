import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma() {
  return {
    processedEvent: {
      create: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new IdempotencyRepository(prisma);
  });

  it("returns true and records the event when it has not been seen before", async () => {
    prisma.processedEvent.create.mockResolvedValue({});
    const result = await repo.tryMarkProcessed("linear", "evt-1");
    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
  });

  it("returns false on a unique-constraint violation (duplicate event)", async () => {
    const duplicateError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.processedEvent.create.mockRejectedValue(duplicateError);
    const result = await repo.tryMarkProcessed("linear", "evt-1");
    expect(result).toBe(false);
  });

  it("rethrows errors that are not a P2002 unique-constraint violation", async () => {
    const otherError = Object.assign(new Error("connection lost"), { code: "P1001" });
    prisma.processedEvent.create.mockRejectedValue(otherError);
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("connection lost");
  });

  it("rethrows a plain Error without a code property", async () => {
    prisma.processedEvent.create.mockRejectedValue(new Error("boom"));
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("boom");
  });

  it("rethrows a non-Error rejection value as-is", async () => {
    prisma.processedEvent.create.mockRejectedValue("not an error");
    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("not an error");
  });
});
