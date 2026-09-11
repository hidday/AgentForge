import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function buildPrisma() {
  const prisma = {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, prismaMock: prisma };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "hi" },
    rawText: "{}",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("ArtifactRepository", () => {
  let prisma: PrismaClient;
  let prismaMock: ReturnType<typeof buildPrisma>["prismaMock"];
  let repo: ArtifactRepository;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    prismaMock = built.prismaMock;
    repo = new ArtifactRepository(prisma);
  });

  describe("create", () => {
    it("creates a row with the given params and maps it to the Artifact domain shape", async () => {
      const row = makeRow();
      prismaMock.aiArtifact.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hi" },
        rawText: "{}",
      });

      expect(prismaMock.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "hi" },
          rawText: "{}",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hi" },
        rawText: "{}",
        createdAt: row.createdAt,
      });
    });

    it("propagates errors from the underlying create call", async () => {
      prismaMock.aiArtifact.create.mockRejectedValue(new Error("write failed"));
      await expect(
        repo.create({ runId: "run-1", type: "Plan", version: 1, payloadJson: {}, rawText: "{}" }),
      ).rejects.toThrow("write failed");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt desc and maps every row", async () => {
      const rows = [
        makeRow({ id: "a2", version: 2, createdAt: new Date("2024-01-02T00:00:00Z") }),
        makeRow({ id: "a1", version: 1, createdAt: new Date("2024-01-01T00:00:00Z") }),
      ];
      prismaMock.aiArtifact.findMany.mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prismaMock.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("a2");
      expect(result[1].id).toBe("a1");
    });

    it("returns an empty array when no artifacts exist for the run", async () => {
      prismaMock.aiArtifact.findMany.mockResolvedValue([]);
      const result = await repo.findByRunId("run-empty");
      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version desc", async () => {
      const row = makeRow({ type: "Review", version: 3 });
      prismaMock.aiArtifact.findFirst.mockResolvedValue(row);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prismaMock.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.type).toBe("Review");
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      prismaMock.aiArtifact.findFirst.mockResolvedValue(null);
      const result = await repo.findLatestByType("run-1", "Review");
      expect(result).toBeNull();
    });
  });
});
