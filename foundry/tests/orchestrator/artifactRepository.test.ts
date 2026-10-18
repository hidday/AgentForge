import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "a plan" },
    rawText: "{}",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
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

type FakePrisma = ReturnType<typeof makePrisma>;

describe("ArtifactRepository", () => {
  let prisma: FakePrisma;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new ArtifactRepository(prisma as unknown as PrismaClient);
  });

  describe("create", () => {
    it("creates an artifact and maps it to the domain shape", async () => {
      const row = makeRow();
      prisma.aiArtifact.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "a plan" },
        rawText: "{}",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "a plan" },
          rawText: "{}",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "a plan" },
        rawText: "{}",
        createdAt: row.createdAt,
      });
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiArtifact.create.mockRejectedValue(new Error("constraint violation"));

      await expect(
        repo.create({
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {},
          rawText: "{}",
        }),
      ).rejects.toThrow("constraint violation");
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts for a run ordered newest first", async () => {
      const rows = [makeRow({ id: "a2", version: 2 }), makeRow({ id: "a1", version: 1 })];
      prisma.aiArtifact.findMany.mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("a2");
      expect(result[1].id).toBe("a1");
    });

    it("returns an empty array when the run has no artifacts", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-without-artifacts");

      expect(result).toEqual([]);
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiArtifact.findMany.mockRejectedValue(new Error("connection lost"));

      await expect(repo.findByRunId("run-1")).rejects.toThrow("connection lost");
    });
  });

  describe("findLatestByType", () => {
    it("returns the highest-version artifact of the given type", async () => {
      const row = makeRow({ version: 3 });
      prisma.aiArtifact.findFirst.mockResolvedValue(row);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Plan" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      prisma.aiArtifact.findFirst.mockResolvedValue(null);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiArtifact.findFirst.mockRejectedValue(new Error("timeout"));

      await expect(repo.findLatestByType("run-1", "Plan")).rejects.toThrow("timeout");
    });
  });
});
