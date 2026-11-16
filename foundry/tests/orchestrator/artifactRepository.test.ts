import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
    rawText: "raw text",
    createdAt: new Date("2024-01-01T00:00:00Z"),
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
  } as unknown as PrismaClient;
}

describe("ArtifactRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new ArtifactRepository(prisma);
  });

  describe("create", () => {
    it("creates an artifact with the given params and returns the mapped domain object", async () => {
      (prisma.aiArtifact.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw text",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { foo: "bar" },
          rawText: "raw text",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw text",
        createdAt: makeRow().createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt desc and maps all rows", async () => {
      const rows = [makeRow({ id: "a1" }), makeRow({ id: "a2", type: "Review" })];
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("a1");
      expect(result[1].type).toBe("Review");
    });

    it("returns an empty array when the run has no artifacts", async () => {
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version desc, returning the mapped artifact", async () => {
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ version: 3 }),
      );

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Plan" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
