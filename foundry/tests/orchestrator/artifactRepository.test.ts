import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
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
  };
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("calls prisma.aiArtifact.create with the expected data payload and maps the row to the domain shape", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiArtifact.create.mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { foo: "bar" },
          rawText: "raw",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw",
        createdAt: row.createdAt,
      });
    });

    it("propagates errors from prisma.aiArtifact.create", async () => {
      const prisma = makePrisma();
      const error = new Error("insert failed");
      prisma.aiArtifact.create.mockRejectedValue(error);
      const repo = new ArtifactRepository(prisma as never);

      await expect(
        repo.create({
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {},
          rawText: "raw",
        }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt desc and maps every row", async () => {
      const prisma = makePrisma();
      const rows = [
        makeRow({ id: "a1", version: 2 }),
        makeRow({ id: "a2", version: 1 }),
      ];
      prisma.aiArtifact.findMany.mockResolvedValue(rows);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("a1");
      expect(result[1].id).toBe("a2");
    });

    it("returns an empty array when there are no matching rows", async () => {
      const prisma = makePrisma();
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-none");

      expect(result).toEqual([]);
    });

    it("propagates errors from prisma.aiArtifact.findMany", async () => {
      const prisma = makePrisma();
      prisma.aiArtifact.findMany.mockRejectedValue(new Error("db down"));
      const repo = new ArtifactRepository(prisma as never);

      await expect(repo.findByRunId("run-1")).rejects.toThrow("db down");
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version desc, and maps a found row", async () => {
      const prisma = makePrisma();
      const row = makeRow({ type: "Review", version: 5 });
      prisma.aiArtifact.findFirst.mockResolvedValue(row);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result).not.toBeNull();
      expect(result?.version).toBe(5);
      expect(result?.type).toBe("Review");
    });

    it("returns null when no artifact of that type exists", async () => {
      const prisma = makePrisma();
      prisma.aiArtifact.findFirst.mockResolvedValue(null);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(result).toBeNull();
    });

    it("propagates errors from prisma.aiArtifact.findFirst", async () => {
      const prisma = makePrisma();
      prisma.aiArtifact.findFirst.mockRejectedValue(new Error("timeout"));
      const repo = new ArtifactRepository(prisma as never);

      await expect(repo.findLatestByType("run-1", "Plan")).rejects.toThrow("timeout");
    });
  });
});
