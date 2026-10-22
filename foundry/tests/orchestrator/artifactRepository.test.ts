import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "A plan" },
    rawText: "raw",
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
    it("persists the artifact via prisma.aiArtifact.create and returns the domain object", async () => {
      const row = makeRow();
      (prisma.aiArtifact.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "A plan" },
        rawText: "raw",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "A plan" },
          rawText: "raw",
        },
      });
      expect(result.id).toBe("artifact-1");
      expect(result.type).toBe("Plan");
      expect(result.payloadJson).toEqual({ summary: "A plan" });
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts ordered by createdAt desc, mapped to domain objects", async () => {
      const rows = [makeRow({ id: "a2", version: 2 }), makeRow({ id: "a1", version: 1 })];
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe("a2");
      expect(result[1]?.id).toBe("a1");
    });

    it("returns an empty array when the run has no artifacts", async () => {
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByRunId("run-with-none");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type, ordered by version desc, and maps the row", async () => {
      const row = makeRow({ id: "a3", version: 3 });
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Plan" },
        orderBy: { version: "desc" },
      });
      expect(result?.id).toBe("a3");
    });

    it("returns null when no artifact of that type exists", async () => {
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
