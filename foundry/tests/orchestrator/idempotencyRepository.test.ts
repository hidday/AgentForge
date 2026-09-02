import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma(create: ReturnType<typeof vi.fn>) {
  return {
    processedEvent: { create },
  } as unknown as PrismaClient;
}

class PrismaKnownError extends Error {
  code: string;
  constructor(code: string) {
    super("prisma error");
    this.code = code;
  }
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  it("returns true when the event is recorded for the first time", async () => {
    const create = vi.fn().mockResolvedValue({ id: "pe-1" });
    const prisma = makePrisma(create);
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(create).toHaveBeenCalledWith({ data: { source: "linear", externalEventId: "evt-1" } });
    expect(result).toBe(true);
  });

  it("returns false when the unique constraint (P2002) rejects a duplicate", async () => {
    const create = vi.fn().mockRejectedValue(new PrismaKnownError("P2002"));
    const prisma = makePrisma(create);
    const repo = new IdempotencyRepository(prisma);

    const result = await repo.tryMarkProcessed("linear", "evt-dup");

    expect(result).toBe(false);
  });

  it("rethrows Error instances carrying a different error code", async () => {
    const err = new PrismaKnownError("P2003");
    const create = vi.fn().mockRejectedValue(err);
    const prisma = makePrisma(create);
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(err);
  });

  it("rethrows Error instances that carry no error code at all", async () => {
    const err = new Error("boom");
    const create = vi.fn().mockRejectedValue(err);
    const prisma = makePrisma(create);
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(err);
  });

  it("rethrows non-Error rejection values unchanged", async () => {
    const err = { code: "P2002" };
    const create = vi.fn().mockRejectedValue(err);
    const prisma = makePrisma(create);
    const repo = new IdempotencyRepository(prisma);

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe(err);
  });
});
