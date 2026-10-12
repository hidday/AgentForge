import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
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

function makePrisma(overrides: Partial<Record<string, unknown>> = {}) {
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
      const prisma = makePrisma({ create: vi.fn().mockResolvedValue(row) });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hello" },
        rawText: "{}",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "hello" },
          rawText: "{}",
        },
      });
      expect(result).toEqual(row);
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by most recent and maps every row", async () => {
      const rows = [makeRow({ id: "a" }), makeRow({ id: "b", type: "Review" })];
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue(rows) });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[1].type).toBe("Review");
    });

    it("returns an empty array when the run has no artifacts", async () => {
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("returns the mapped artifact ordered by version descending when found", async () => {
      const row = makeRow({ type: "Review", version: 3 });
      const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(row) });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "Remediation");

      expect(result).toBeNull();
    });
  });
});
