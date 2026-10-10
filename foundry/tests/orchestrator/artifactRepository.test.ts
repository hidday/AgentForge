import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "test" },
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
  } as unknown as PrismaClient;
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("creates an artifact with the given params and maps the result", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });

      const repo = new ArtifactRepository(prisma);
      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "test" },
        rawText: "{}",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "test" },
          rawText: "{}",
        },
      });
      expect(result.id).toBe("artifact-1");
      expect(result.type).toBe("Plan");
      expect(result.payloadJson).toEqual({ summary: "test" });
    });
  });

  describe("findByRunId", () => {
    it("queries artifacts for the run ordered by createdAt desc and maps results", async () => {
      const rows = [makeRow({ id: "a1" }), makeRow({ id: "a2" })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });

      const repo = new ArtifactRepository(prisma);
      const result = await repo.findByRunId("run-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((r) => r.id)).toEqual(["a1", "a2"]);
    });

    it("returns an empty array when there are no artifacts", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });

      const repo = new ArtifactRepository(prisma);
      const result = await repo.findByRunId("run-1");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version desc and maps the result", async () => {
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

    it("returns null when no artifact of that type exists", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });

      const repo = new ArtifactRepository(prisma);
      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
