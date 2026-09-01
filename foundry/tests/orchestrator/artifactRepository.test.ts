import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "hi" },
    rawText: "{}",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("passes params through to prisma and maps the returned row", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hi" },
        rawText: "{}",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "hi" },
          rawText: "{}",
        },
      });
      expect(result).toEqual({ ...row, type: "Plan" });
    });
  });

  describe("findByRunId", () => {
    it("orders by createdAt desc and maps every row", async () => {
      const rows = [makeRow({ id: "a" }), makeRow({ id: "b", type: "Review" })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a", "b"]);
      expect(result[1].type).toBe("Review");
    });

    it("returns an empty array when there are no artifacts", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new ArtifactRepository(prisma);

      expect(await repo.findByRunId("run-none")).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("filters by runId and type, orders by version desc, and maps the row", async () => {
      const row = makeRow({ version: 3 });
      const findFirst = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ findFirst });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Plan" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new ArtifactRepository(prisma);

      expect(await repo.findLatestByType("run-1", "Review")).toBeNull();
    });
  });
});
