import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function buildPrisma() {
  const prisma = {
    processedEvent: {
      create: vi.fn(),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, prismaMock: prisma };
}

describe("IdempotencyRepository", () => {
  let prisma: PrismaClient;
  let prismaMock: ReturnType<typeof buildPrisma>["prismaMock"];
  let repo: IdempotencyRepository;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    prismaMock = built.prismaMock;
    repo = new IdempotencyRepository(prisma);
  });

  it("returns true and records the event when it is seen for the first time", async () => {
    prismaMock.processedEvent.create.mockResolvedValue({
      id: "1",
      source: "github",
      externalEventId: "evt-1",
    });

    const result = await repo.tryMarkProcessed("github", "evt-1");

    expect(prismaMock.processedEvent.create).toHaveBeenCalledWith({
      data: { source: "github", externalEventId: "evt-1" },
    });
    expect(result).toBe(true);
  });

  it("returns false when the event was already processed (unique constraint violation P2002)", async () => {
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prismaMock.processedEvent.create.mockRejectedValue(err);

    const result = await repo.tryMarkProcessed("github", "evt-1");

    expect(result).toBe(false);
  });

  it("re-throws non-P2002 errors instead of swallowing them", async () => {
    const err = Object.assign(new Error("connection refused"), { code: "P1001" });
    prismaMock.processedEvent.create.mockRejectedValue(err);

    await expect(repo.tryMarkProcessed("github", "evt-1")).rejects.toThrow("connection refused");
  });

  it("re-throws errors that are not Error instances or lack a code property", async () => {
    prismaMock.processedEvent.create.mockRejectedValue("not an error object");

    await expect(repo.tryMarkProcessed("github", "evt-1")).rejects.toBe("not an error object");
  });
});
