import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    processedEvent: {
      create: vi.fn(),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository", () => {
  it("returns true and records the event when seen for the first time", async () => {
    const create = vi.fn().mockResolvedValue({ id: "pe-1" });
    const prisma = makePrisma({ create });
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false when the event was already processed (Prisma P2002 unique violation)", async () => {
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const create = vi.fn().mockRejectedValue(err);
    const prisma = makePrisma({ create });
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "evt-dup");

    expect(result).toBe(false);
  });

  it("rethrows Error instances that are not P2002 unique violations", async () => {
    const err = Object.assign(new Error("connection lost"), { code: "P1001" });
    const create = vi.fn().mockRejectedValue(err);
    const prisma = makePrisma({ create });
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-2")).rejects.toThrow("connection lost");
  });

  it("rethrows Error instances that have no code property", async () => {
    const err = new Error("generic failure");
    const create = vi.fn().mockRejectedValue(err);
    const prisma = makePrisma({ create });
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-3")).rejects.toThrow("generic failure");
  });

  it("rethrows non-Error values unchanged", async () => {
    const create = vi.fn().mockRejectedValue("boom");
    const prisma = makePrisma({ create });
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-4")).rejects.toBe("boom");
  });
});
