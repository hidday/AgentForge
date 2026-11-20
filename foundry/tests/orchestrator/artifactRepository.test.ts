import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
    rawText: '{"foo":"bar"}',
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
    it("forwards params to prisma and returns the mapped Artifact", async () => {
      prisma.aiArtifact.create.mockResolvedValue(makeRow());

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: '{"foo":"bar"}',
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { foo: "bar" },
          rawText: '{"foo":"bar"}',
        },
      });
      expect(result.id).toBe("artifact-1");
      expect(result.type).toBe("Plan");
      expect(result.payloadJson).toEqual({ foo: "bar" });
    });

    it("propagates errors from prisma", async () => {
      prisma.aiArtifact.create.mockRejectedValue(new Error("db error"));
      await expect(
        repo.create({
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {},
          rawText: "{}",
        }),
      ).rejects.toThrow("db error");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt desc and maps all rows", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([
        makeRow({ id: "a" }),
        makeRow({ id: "b" }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when there are no artifacts", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const result = await repo.findByRunId("run-none");
      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version desc", async () => {
      prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ type: "Review", version: 3 }));

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
