import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "do the thing" },
    rawText: "raw plan text",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makePrisma() {
  const aiArtifact = {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  };
  return { aiArtifact } as unknown as PrismaClient & { aiArtifact: typeof aiArtifact };
}

describe("ArtifactRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new ArtifactRepository(prisma);
  });

  describe("create", () => {
    it("persists the artifact and maps the returned row to the domain shape", async () => {
      const row = makeRow();
      prisma.aiArtifact.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "do the thing" },
        rawText: "raw plan text",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "do the thing" },
          rawText: "raw plan text",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "do the thing" },
        rawText: "raw plan text",
        createdAt: row.createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts for the run ordered as returned by prisma (desc by createdAt)", async () => {
      const rows = [makeRow({ id: "a2", version: 2 }), makeRow({ id: "a1", version: 1 })];
      prisma.aiArtifact.findMany.mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a2", "a1"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const result = await repo.findByRunId("run-none");
      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("returns the latest artifact of the given type", async () => {
      const row = makeRow({ type: "Review", version: 3 });
      prisma.aiArtifact.findFirst.mockResolvedValue(row);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
      expect(result?.type).toBe("Review");
    });

    it("returns null when no artifact of that type exists", async () => {
      prisma.aiArtifact.findFirst.mockResolvedValue(null);
      const result = await repo.findLatestByType("run-1", "Review");
      expect(result).toBeNull();
    });
  });
});
