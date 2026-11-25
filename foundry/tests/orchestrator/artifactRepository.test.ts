import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
    rawText: "{}",
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
    it("persists the artifact and returns the mapped domain object", async () => {
      prisma.aiArtifact.create.mockResolvedValue(makeRow());

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "{}",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { foo: "bar" },
          rawText: "{}",
        },
      });
      expect(result.id).toBe("artifact-1");
      expect(result.type).toBe("Plan");
      expect(result.payloadJson).toEqual({ foo: "bar" });
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts ordered by most recent first, mapped to domain objects", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([
        makeRow({ id: "a2", version: 2 }),
        makeRow({ id: "a1", version: 1 }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a2", "a1"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-1");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type, ordered by version descending", async () => {
      prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ type: "Review", version: 3 }));

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.type).toBe("Review");
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      prisma.aiArtifact.findFirst.mockResolvedValue(null);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
