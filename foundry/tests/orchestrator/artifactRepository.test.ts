import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { planVersion: 1 },
    rawText: "raw",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
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
  };
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("creates an artifact and maps the returned row to the domain object", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiArtifact.create.mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { planVersion: 1 },
        rawText: "raw",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { planVersion: 1 },
          rawText: "raw",
        },
      });
      expect(result).toEqual(row);
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered newest first and maps each row", async () => {
      const prisma = makePrisma();
      const rows = [makeRow({ id: "a1", version: 2 }), makeRow({ id: "a2", version: 1 })];
      prisma.aiArtifact.findMany.mockResolvedValue(rows);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a1", "a2"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      const prisma = makePrisma();
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-none");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version desc, returns mapped artifact", async () => {
      const prisma = makePrisma();
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

    it("returns null when there is no artifact of that type for the run", async () => {
      const prisma = makePrisma();
      prisma.aiArtifact.findFirst.mockResolvedValue(null);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(result).toBeNull();
    });
  });
});
