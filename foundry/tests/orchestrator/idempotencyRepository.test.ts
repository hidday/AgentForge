import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makePrisma(createImpl: (...args: unknown[]) => unknown) {
  return {
    processedEvent: {
      create: vi.fn(createImpl),
    },
  } as unknown as import("../../src/generated/prisma/client.js").PrismaClient;
}

describe("IdempotencyRepository", () => {
  it("returns true when the event is newly recorded", async () => {
    const prisma = makePrisma(() => Promise.resolve({ id: "1" }));
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(true);
    expect(prisma.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
  });

  it("returns false when the event is a duplicate (Prisma P2002 unique constraint error)", async () => {
    const duplicateError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    const prisma = makePrisma(() => Promise.reject(duplicateError));
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("github", "evt-2");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not P2002 duplicate errors", async () => {
    const otherError = Object.assign(new Error("connection refused"), { code: "P1001" });
    const prisma = makePrisma(() => Promise.reject(otherError));
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("github", "evt-3")).rejects.toThrow("connection refused");
  });

  it("rethrows non-Error throwables untouched", async () => {
    const prisma = makePrisma(() => Promise.reject("boom"));
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("github", "evt-4")).rejects.toBe("boom");
  });
});
