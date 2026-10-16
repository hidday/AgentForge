import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma(overrides: {
  create?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  findFirst?: ReturnType<typeof vi.fn>;
}) {
  return {
    aiArtifact: {
      create: overrides.create ?? vi.fn(),
      findMany: overrides.findMany ?? vi.fn(),
      findFirst: overrides.findFirst ?? vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("calls aiArtifact.create with the expected data payload and maps the row", async () => {
      const createdAt = new Date("2026-02-01T00:00:00.000Z");
      const row = {
        id: "art-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: [] },
        rawText: "plan text",
        createdAt,
      };
      const create = vi.fn().mockResolvedValue(row);
      const repo = new ArtifactRepository(makePrisma({ create }));

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: [] },
        rawText: "plan text",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { steps: [] },
          rawText: "plan text",
        },
      });
      expect(result).toEqual({
        id: "art-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: [] },
        rawText: "plan text",
        createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt descending and maps every row", async () => {
      const rows = [
        {
          id: "art-2",
          runId: "run-1",
          type: "Review",
          version: 2,
          payloadJson: { ok: true },
          rawText: "review text",
          createdAt: new Date("2026-02-02T00:00:00.000Z"),
        },
        {
          id: "art-1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { steps: [] },
          rawText: "plan text",
          createdAt: new Date("2026-02-01T00:00:00.000Z"),
        },
      ];
      const findMany = vi.fn().mockResolvedValue(rows);
      const repo = new ArtifactRepository(makePrisma({ findMany }));

      const result = await repo.findByRunId("run-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("art-2");
      expect(result[0].type).toBe("Review");
    });

    it("returns an empty array when the run has no artifacts", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repo = new ArtifactRepository(makePrisma({ findMany }));

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type, ordered by version descending, and maps a found row", async () => {
      const row = {
        id: "art-3",
        runId: "run-1",
        type: "ExecutionReport",
        version: 5,
        payloadJson: { success: true },
        rawText: "report",
        createdAt: new Date("2026-02-03T00:00:00.000Z"),
      };
      const findFirst = vi.fn().mockResolvedValue(row);
      const repo = new ArtifactRepository(makePrisma({ findFirst }));

      const result = await repo.findLatestByType("run-1", "ExecutionReport");

      expect(findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "ExecutionReport" },
        orderBy: { version: "desc" },
      });
      expect(result).toEqual({
        id: "art-3",
        runId: "run-1",
        type: "ExecutionReport",
        version: 5,
        payloadJson: { success: true },
        rawText: "report",
        createdAt: row.createdAt,
      });
    });

    it("returns null when no artifact of that type exists for the run", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const repo = new ArtifactRepository(makePrisma({ findFirst }));

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(result).toBeNull();
    });
  });
});
