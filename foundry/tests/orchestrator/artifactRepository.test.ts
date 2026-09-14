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
    rawText: '{"foo":"bar"}',
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
  };
}

describe("ArtifactRepository", () => {
  describe("create", () => {
    it("creates an artifact with the given fields and maps the row back", async () => {
      const prisma = makePrismaMock();
      prisma.aiArtifact.create.mockResolvedValue(makeRow());
      const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

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
      expect(result.payloadJson).toEqual({ foo: "bar" });
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts ordered by createdAt desc", async () => {
      const prisma = makePrismaMock();
      prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "artifact-2" })]);
      const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });

    it("returns an empty array when there are no artifacts for the run", async () => {
      const prisma = makePrismaMock();
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

      expect(await repo.findByRunId("run-1")).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("finds the highest-version artifact of the given type", async () => {
      const prisma = makePrismaMock();
      prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ type: "Review", version: 3 }));
      const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      const prisma = makePrismaMock();
      prisma.aiArtifact.findFirst.mockResolvedValue(null);
      const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

      expect(await repo.findLatestByType("run-1", "Review")).toBeNull();
    });
  });
});
