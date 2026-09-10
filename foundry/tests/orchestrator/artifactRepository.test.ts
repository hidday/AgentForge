import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("maps params into the create call shape and returns the domain object", async () => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const row = {
        id: "art-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: [] },
        rawText: "the plan",
        createdAt,
      };
      const create = vi.fn().mockResolvedValue(row);
      const prisma = { aiArtifact: { create } } as unknown as PrismaClient;
      const repo = new ArtifactRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: [] },
        rawText: "the plan",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { steps: [] },
          rawText: "the plan",
        },
      });
      expect(result).toEqual({
        id: "art-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { steps: [] },
        rawText: "the plan",
        createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("orders by createdAt desc and maps every row", async () => {
      const rows = [
        {
          id: "art-2",
          runId: "run-1",
          type: "Review",
          version: 2,
          payloadJson: {},
          rawText: "r2",
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
        },
        {
          id: "art-1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {},
          rawText: "r1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = { aiArtifact: { findMany } } as unknown as PrismaClient;
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("art-2");
    });
  });

  describe("findLatestByType", () => {
    it("orders by version desc, filters by runId and type, and returns the mapped domain object", async () => {
      const row = {
        id: "art-3",
        runId: "run-1",
        type: "ExecutionReport",
        version: 3,
        payloadJson: { done: true },
        rawText: "report",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      };
      const findFirst = vi.fn().mockResolvedValue(row);
      const prisma = { aiArtifact: { findFirst } } as unknown as PrismaClient;
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-1", "ExecutionReport");

      expect(findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "ExecutionReport" },
        orderBy: { version: "desc" },
      });
      expect(result).toEqual({
        id: "art-3",
        runId: "run-1",
        type: "ExecutionReport",
        version: 3,
        payloadJson: { done: true },
        rawText: "report",
        createdAt: row.createdAt,
      });
    });

    it("returns null when Prisma returns null (no such artifact)", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = { aiArtifact: { findFirst } } as unknown as PrismaClient;
      const repo = new ArtifactRepository(prisma);

      const result = await repo.findLatestByType("run-none", "Plan");

      expect(result).toBeNull();
    });
  });
});
