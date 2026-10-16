import { describe, it, expect, vi } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma(create: ReturnType<typeof vi.fn>) {
  return {
    processedEvent: { create },
  } as unknown as PrismaClient;
}

describe("IdempotencyRepository.tryMarkProcessed", () => {
  it("returns true and creates the processedEvent row on first sighting", async () => {
    const create = vi.fn().mockResolvedValue({ id: "pe-1" });
    const repo = new IdempotencyRepository(makePrisma(create));

    const result = await repo.tryMarkProcessed("linear", "evt-123");

    expect(result).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: { source: "linear", externalEventId: "evt-123" },
    });
  });

  it("returns false on a P2002 unique-constraint violation (duplicate event)", async () => {
    const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const create = vi.fn().mockRejectedValue(error);
    const repo = new IdempotencyRepository(makePrisma(create));

    const result = await repo.tryMarkProcessed("github", "evt-456");

    expect(result).toBe(false);
  });

  it("rethrows errors that are not a P2002 violation", async () => {
    const error = Object.assign(new Error("connection lost"), { code: "P1001" });
    const create = vi.fn().mockRejectedValue(error);
    const repo = new IdempotencyRepository(makePrisma(create));

    await expect(repo.tryMarkProcessed("github", "evt-789")).rejects.toThrow("connection lost");
  });

  it("rethrows a plain Error without a code property", async () => {
    const error = new Error("unexpected failure");
    const create = vi.fn().mockRejectedValue(error);
    const repo = new IdempotencyRepository(makePrisma(create));

    await expect(repo.tryMarkProcessed("github", "evt-999")).rejects.toThrow("unexpected failure");
  });

  it("rethrows a non-Error rejection value as-is", async () => {
    const create = vi.fn().mockRejectedValue("not an error object");
    const repo = new IdempotencyRepository(makePrisma(create));

    await expect(repo.tryMarkProcessed("github", "evt-str")).rejects.toBe("not an error object");
  });
});
