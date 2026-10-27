import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
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
    it("passes the correct data to prisma and maps the resulting row to the domain Artifact", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "{}",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { foo: "bar" },
          rawText: "{}",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "{}",
        createdAt: row.createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt desc and maps every row", async () => {
      const rows = [makeRow({ id: "a1", version: 2 }), makeRow({ id: "a2", version: 1 })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("a1");
      expect(result[1].id).toBe("a2");
    });

    it("returns an empty array when there are no artifacts for the run", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-missing");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version desc and maps the row", async () => {
      const row = makeRow({ version: 5 });
      const findFirst = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ findFirst });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Plan" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(5);
    });

    it("returns null when no artifact of that type exists for the run", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
