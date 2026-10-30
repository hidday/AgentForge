import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "test" },
    rawText: "raw text",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrismaMock() {
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
  describe("create", () => {
    it("creates an artifact row and maps it to the domain shape", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      prisma.aiArtifact.create.mockResolvedValue(row);

      const repo = new ArtifactRepository(prisma);
      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "test" },
        rawText: "raw text",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "test" },
          rawText: "raw text",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "test" },
        rawText: "raw text",
        createdAt: row.createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts ordered by createdAt desc, mapped to domain shape", async () => {
      const prisma = makePrismaMock();
      const rows = [
        makeRow({ id: "a2", version: 2 }),
        makeRow({ id: "a1", version: 1 }),
      ];
      prisma.aiArtifact.findMany.mockResolvedValue(rows);

      const repo = new ArtifactRepository(prisma);
      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("a2");
      expect(result[1]!.id).toBe("a1");
    });

    it("returns an empty array when the run has no artifacts", async () => {
      const prisma = makePrismaMock();
      prisma.aiArtifact.findMany.mockResolvedValue([]);

      const repo = new ArtifactRepository(prisma);
      const result = await repo.findByRunId("run-missing");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("returns the artifact mapped to domain shape when found", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({ type: "Review", version: 3 });
      prisma.aiArtifact.findFirst.mockResolvedValue(row);

      const repo = new ArtifactRepository(prisma);
      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result).not.toBeNull();
      expect(result!.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      const prisma = makePrismaMock();
      prisma.aiArtifact.findFirst.mockResolvedValue(null);

      const repo = new ArtifactRepository(prisma);
      const result = await repo.findLatestByType("run-1", "Plan");

      expect(result).toBeNull();
    });
  });
});
