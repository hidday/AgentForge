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
    createdAt: new Date("2026-01-01T00:00:00Z"),
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
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new ArtifactRepository(prisma);
  });

  describe("create", () => {
    it("creates an artifact with the given params and returns the mapped result", async () => {
      const row = makeRow();
      prisma.aiArtifact.create.mockResolvedValue(row);

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
        createdAt: row.createdAt,
      });
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiArtifact.create.mockRejectedValue(new Error("db unavailable"));

      await expect(
        repo.create({
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {},
          rawText: "",
        }),
      ).rejects.toThrow("db unavailable");
    });
  });

  describe("findByRunId", () => {
    it("returns mapped artifacts ordered by createdAt desc", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "artifact-2" })]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.id)).toEqual(["artifact-1", "artifact-2"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries for the highest version of the given type and returns it mapped", async () => {
      prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ version: 3 }));

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
  });
});
