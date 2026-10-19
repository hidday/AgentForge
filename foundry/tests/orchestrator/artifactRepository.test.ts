import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeMockPrisma() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("ArtifactRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new ArtifactRepository(prisma);
  });

  describe("create", () => {
    it("creates an artifact row and maps it to the domain shape", async () => {
      const createdAt = new Date("2024-01-01T00:00:00Z");
      (prisma.aiArtifact.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "art-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw",
        createdAt,
      });

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { foo: "bar" },
          rawText: "raw",
        },
      });
      expect(result).toEqual({
        id: "art-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw",
        createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts for a run ordered by createdAt desc, mapped to domain shape", async () => {
      const rows = [
        {
          id: "art-2",
          runId: "run-1",
          type: "Review",
          version: 2,
          payloadJson: { a: 1 },
          rawText: "two",
          createdAt: new Date("2024-01-02T00:00:00Z"),
        },
        {
          id: "art-1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { a: 0 },
          rawText: "one",
          createdAt: new Date("2024-01-01T00:00:00Z"),
        },
      ];
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("art-2");
      expect(result[1].id).toBe("art-1");
    });

    it("returns an empty array when the run has no artifacts", async () => {
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await repo.findByRunId("run-none");
      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("returns the highest-version artifact of the given type", async () => {
      const row = {
        id: "art-3",
        runId: "run-1",
        type: "ExecutionReport",
        version: 3,
        payloadJson: {},
        rawText: "latest",
        createdAt: new Date("2024-01-03T00:00:00Z"),
      };
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.findLatestByType("run-1", "ExecutionReport");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "ExecutionReport" },
        orderBy: { version: "desc" },
      });
      expect(result?.id).toBe("art-3");
    });

    it("returns null when no artifact of that type exists for the run", async () => {
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await repo.findLatestByType("run-1", "Plan");
      expect(result).toBeNull();
    });
  });
});
