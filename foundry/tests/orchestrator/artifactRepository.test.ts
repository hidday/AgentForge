import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "hello" },
    rawText: "raw plan text",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeFakePrisma() {
  const aiArtifact = {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  };
  return { aiArtifact };
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("calls aiArtifact.create with the provided fields and maps the result", async () => {
      const prisma = makeFakePrisma();
      const row = makeRow();
      prisma.aiArtifact.create.mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hello" },
        rawText: "raw plan text",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "hello" },
          rawText: "raw plan text",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hello" },
        rawText: "raw plan text",
        createdAt: row.createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered newest-first and maps every row", async () => {
      const prisma = makeFakePrisma();
      const rows = [
        makeRow({ id: "a", version: 2 }),
        makeRow({ id: "b", version: 1 }),
      ];
      prisma.aiArtifact.findMany.mockResolvedValue(rows);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("a");
      expect(result[1].id).toBe("b");
    });

    it("returns an empty array when the run has no artifacts", async () => {
      const prisma = makeFakePrisma();
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const repo = new ArtifactRepository(prisma as never);

      expect(await repo.findByRunId("run-1")).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version desc, returning the mapped row", async () => {
      const prisma = makeFakePrisma();
      const row = makeRow({ type: "Review", version: 3 });
      prisma.aiArtifact.findFirst.mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
      expect(result?.type).toBe("Review");
    });

    it("returns null when no artifact of that type exists", async () => {
      const prisma = makeFakePrisma();
      prisma.aiArtifact.findFirst.mockResolvedValue(null);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
