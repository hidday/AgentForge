import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrismaMock() {
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
    it("creates an artifact with the given fields and maps the result", async () => {
      const prisma = makePrismaMock();
      const createdAt = new Date("2026-01-01T00:00:00Z");
      const row = {
        id: "art-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: [] },
        rawText: "raw plan text",
        createdAt,
      };
      prisma.aiArtifact.create.mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: [] },
        rawText: "raw plan text",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { steps: [] },
          rawText: "raw plan text",
        },
      });
      expect(result).toEqual({
        id: "art-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: [] },
        rawText: "raw plan text",
        createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt descending and maps every row", async () => {
      const prisma = makePrismaMock();
      const rows = [
        {
          id: "art-2",
          runId: "run-1",
          type: "Review",
          version: 2,
          payloadJson: {},
          rawText: "second",
          createdAt: new Date("2026-01-02T00:00:00Z"),
        },
        {
          id: "art-1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {},
          rawText: "first",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ];
      prisma.aiArtifact.findMany.mockResolvedValue(rows);
      const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(rows);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      const prisma = makePrismaMock();
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByRunId("run-none");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("returns the mapped artifact when one is found", async () => {
      const prisma = makePrismaMock();
      const row = {
        id: "art-3",
        runId: "run-1",
        type: "Review",
        version: 3,
        payloadJson: { ok: true },
        rawText: "latest review",
        createdAt: new Date("2026-01-03T00:00:00Z"),
      };
      prisma.aiArtifact.findFirst.mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result).toEqual(row);
    });

    it("returns null when no artifact of the type exists", async () => {
      const prisma = makePrismaMock();
      prisma.aiArtifact.findFirst.mockResolvedValue(null);
      const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(result).toBeNull();
    });
  });
});
