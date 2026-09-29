import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "hello" },
    rawText: "{}",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("passes params through to prisma with payloadJson cast and returns the mapped artifact", async () => {
      const prisma = buildPrismaMock();
      const row = makeRow();
      prisma.aiArtifact.create.mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hello" },
        rawText: "{}",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "hello" },
          rawText: "{}",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hello" },
        rawText: "{}",
        createdAt: row.createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt desc and maps every row", async () => {
      const prisma = buildPrismaMock();
      prisma.aiArtifact.findMany.mockResolvedValue([
        makeRow({ id: "a", version: 2 }),
        makeRow({ id: "b", version: 1 }),
      ]);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      const prisma = buildPrismaMock();
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type, ordered by version desc, and returns the mapped artifact", async () => {
      const prisma = buildPrismaMock();
      const row = makeRow({ type: "Review", version: 3 });
      prisma.aiArtifact.findFirst.mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.type).toBe("Review");
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      const prisma = buildPrismaMock();
      prisma.aiArtifact.findFirst.mockResolvedValue(null);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(result).toBeNull();
    });
  });
});
