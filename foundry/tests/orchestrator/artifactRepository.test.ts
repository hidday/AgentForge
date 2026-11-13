import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { steps: ["a", "b"] },
    rawText: "raw plan text",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient & {
    aiArtifact: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
}

describe("ArtifactRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new ArtifactRepository(prisma);
  });

  describe("create", () => {
    it("passes all fields through to prisma and returns the mapped Artifact", async () => {
      const row = makeRow();
      prisma.aiArtifact.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: ["a", "b"] },
        rawText: "raw plan text",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { steps: ["a", "b"] },
          rawText: "raw plan text",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: ["a", "b"] },
        rawText: "raw plan text",
        createdAt: row.createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt desc and maps every row", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([
        makeRow({ id: "a", type: "Plan" }),
        makeRow({ id: "b", type: "Review" }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a", "b"]);
      expect(result.map((a) => a.type)).toEqual(["Plan", "Review"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId + type ordered by version desc and returns the mapped Artifact", async () => {
      const row = makeRow({ version: 3, type: "ExecutionReport" });
      prisma.aiArtifact.findFirst.mockResolvedValue(row);

      const result = await repo.findLatestByType("run-1", "ExecutionReport");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "ExecutionReport" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
      expect(result?.type).toBe("ExecutionReport");
    });

    it("returns null when no artifact of that type exists for the run", async () => {
      prisma.aiArtifact.findFirst.mockResolvedValue(null);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
