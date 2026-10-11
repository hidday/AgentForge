import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "hello" },
    rawText: "{}",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      ...overrides,
    },
  } as never;
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("creates an artifact with the given fields and maps the result", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hello" },
        rawText: "{}",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "hello" },
          rawText: "{}",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hello" },
        rawText: "{}",
        createdAt: row.createdAt,
      });
    });

    it("propagates errors from the underlying create call", async () => {
      const create = vi.fn().mockRejectedValue(new Error("insert failed"));
      const prisma = makePrisma({ create });
      const repo = new ArtifactRepository(prisma);

      await expect(
        repo.create({ runId: "run-1", type: "Plan", version: 1, payloadJson: {}, rawText: "{}" }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt desc", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual([]);
    });

    it("maps multiple rows preserving order and remapping the type field", async () => {
      const rows = [
        makeRow({ id: "a", type: "Plan" }),
        makeRow({ id: "b", type: "Review" }),
      ];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(result.map((a) => a.id)).toEqual(["a", "b"]);
      expect(result.map((a) => a.type)).toEqual(["Plan", "Review"]);
    });

    it("propagates errors from the underlying findMany call", async () => {
      const findMany = vi.fn().mockRejectedValue(new Error("query failed"));
      const prisma = makePrisma({ findMany });
      const repo = new ArtifactRepository(prisma);

      await expect(repo.findByRunId("run-1")).rejects.toThrow("query failed");
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version desc", async () => {
      const row = makeRow({ version: 3 });
      const findFirst = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ findFirst });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Plan" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
    });

    it("returns null when prisma returns null (no artifact of that type)", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });

    it("propagates errors from the underlying findFirst call", async () => {
      const findFirst = vi.fn().mockRejectedValue(new Error("boom"));
      const prisma = makePrisma({ findFirst });
      const repo = new ArtifactRepository(prisma);

      await expect(repo.findLatestByType("run-1", "Plan")).rejects.toThrow("boom");
    });
  });
});
