import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "hi" },
    rawText: "{}",
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
  };
}

describe("ArtifactRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new ArtifactRepository(prisma as never);
  });

  describe("create", () => {
    it("creates an artifact and maps it to the domain shape", async () => {
      prisma.aiArtifact.create.mockResolvedValue(makeRow());
      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hi" },
        rawText: "{}",
      });
      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "hi" },
          rawText: "{}",
        },
      });
      expect(result.id).toBe("artifact-1");
      expect(result.type).toBe("Plan");
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts ordered descending by createdAt", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "artifact-2" })]);
      const result = await repo.findByRunId("run-1");
      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["artifact-1", "artifact-2"]);
    });

    it("returns an empty array when there are no artifacts", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const result = await repo.findByRunId("run-none");
      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("returns the mapped artifact when found", async () => {
      prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ type: "Review" }));
      const result = await repo.findLatestByType("run-1", "Review");
      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.type).toBe("Review");
    });

    it("returns null when no artifact of the given type exists", async () => {
      prisma.aiArtifact.findFirst.mockResolvedValue(null);
      const result = await repo.findLatestByType("run-1", "Review");
      expect(result).toBeNull();
    });
  });
});
