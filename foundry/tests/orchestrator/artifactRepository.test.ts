import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeMockPrisma() {
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
    it("creates an artifact and maps the row to the domain shape", async () => {
      const mockPrisma = makeMockPrisma();
      const createdAt = new Date("2024-01-01T00:00:00.000Z");
      mockPrisma.aiArtifact.create.mockResolvedValue({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "ok" },
        rawText: "raw",
        createdAt,
      });

      const repo = new ArtifactRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "ok" },
        rawText: "raw",
      });

      expect(mockPrisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "ok" },
          rawText: "raw",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "ok" },
        rawText: "raw",
        createdAt,
      });
    });

    it("propagates errors from the underlying prisma call", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiArtifact.create.mockRejectedValue(new Error("write failed"));

      const repo = new ArtifactRepository(mockPrisma as unknown as PrismaClient);
      await expect(
        repo.create({
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {},
          rawText: "raw",
        }),
      ).rejects.toThrow("write failed");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered descending by createdAt", async () => {
      const mockPrisma = makeMockPrisma();
      const rows = [
        {
          id: "artifact-2",
          runId: "run-1",
          type: "Review",
          version: 2,
          payloadJson: {},
          rawText: "r2",
          createdAt: new Date("2024-01-02T00:00:00.000Z"),
        },
        {
          id: "artifact-1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {},
          rawText: "r1",
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ];
      mockPrisma.aiArtifact.findMany.mockResolvedValue(rows);

      const repo = new ArtifactRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findByRunId("run-1");

      expect(mockPrisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(rows);
    });

    it("returns an empty array when no artifacts exist", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiArtifact.findMany.mockResolvedValue([]);

      const repo = new ArtifactRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findByRunId("run-missing");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered descending by version and maps the row", async () => {
      const mockPrisma = makeMockPrisma();
      const row = {
        id: "artifact-3",
        runId: "run-1",
        type: "ExecutionReport",
        version: 3,
        payloadJson: { score: 0.9 },
        rawText: "r3",
        createdAt: new Date("2024-01-03T00:00:00.000Z"),
      };
      mockPrisma.aiArtifact.findFirst.mockResolvedValue(row);

      const repo = new ArtifactRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findLatestByType("run-1", "ExecutionReport");

      expect(mockPrisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "ExecutionReport" },
        orderBy: { version: "desc" },
      });
      expect(result).toEqual(row);
    });

    it("returns null when no matching artifact exists", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiArtifact.findFirst.mockResolvedValue(null);

      const repo = new ArtifactRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findLatestByType("run-1", "Plan");

      expect(result).toBeNull();
    });

    it("propagates errors from the underlying prisma call", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiArtifact.findFirst.mockRejectedValue(new Error("read failed"));

      const repo = new ArtifactRepository(mockPrisma as unknown as PrismaClient);
      await expect(repo.findLatestByType("run-1", "Plan")).rejects.toThrow("read failed");
    });
  });
});
