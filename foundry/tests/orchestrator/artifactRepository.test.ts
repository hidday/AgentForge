import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "test" },
    rawText: '{"summary":"test"}',
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      ...overrides,
    },
  };
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("creates an artifact with the given params and maps to domain", async () => {
      const row = makeRow();
      const prisma = buildPrisma({ create: vi.fn().mockResolvedValue(row) });
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "test" },
        rawText: '{"summary":"test"}',
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "test" },
          rawText: '{"summary":"test"}',
        },
      });
      expect(result.id).toBe("artifact-1");
      expect(result.type).toBe("Plan");
      expect(result.payloadJson).toEqual({ summary: "test" });
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts ordered by createdAt desc, mapped to domain", async () => {
      const rows = [makeRow({ id: "a1" }), makeRow({ id: "a2" })];
      const prisma = buildPrisma({ findMany: vi.fn().mockResolvedValue(rows) });
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a1", "a2"]);
    });

    it("returns an empty array when no artifacts exist", async () => {
      const prisma = buildPrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId/type ordered by version desc and maps the row", async () => {
      const row = makeRow({ version: 3 });
      const prisma = buildPrisma({ findFirst: vi.fn().mockResolvedValue(row) });
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Plan" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
    });

    it("returns null when no matching artifact exists", async () => {
      const prisma = buildPrisma({ findFirst: vi.fn().mockResolvedValue(null) });
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
