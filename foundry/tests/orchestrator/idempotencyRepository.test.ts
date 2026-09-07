import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma(create: ReturnType<typeof vi.fn>) {
  return {
    processedEvent: { create },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  it("returns true when the event is recorded for the first time", async () => {
    const create = vi.fn().mockResolvedValue({ id: "pe-1" });
    const repo = new IdempotencyRepository(makePrisma(create));

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false when a unique constraint violation (P2002) indicates a duplicate", async () => {
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const create = vi.fn().mockRejectedValue(err);
    const repo = new IdempotencyRepository(makePrisma(create));

    const result = await repo.tryMarkProcessed("linear", "evt-1");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not P2002 unique-constraint violations", async () => {
    const err = Object.assign(new Error("Connection lost"), { code: "P1001" });
    const create = vi.fn().mockRejectedValue(err);
    const repo = new IdempotencyRepository(makePrisma(create));

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toThrow("Connection lost");
  });

  it("rethrows non-Error rejections untouched", async () => {
    const create = vi.fn().mockRejectedValue("plain string failure");
    const repo = new IdempotencyRepository(makePrisma(create));

    await expect(repo.tryMarkProcessed("linear", "evt-1")).rejects.toBe("plain string failure");
  });
});
