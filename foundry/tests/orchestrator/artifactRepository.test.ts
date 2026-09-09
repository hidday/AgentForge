import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

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

function buildPrismaMock() {
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
    it("persists an artifact and maps the domain shape back", async () => {
      const prisma = buildPrismaMock();
      prisma.aiArtifact.create.mockResolvedValue(makeRow());
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "{}",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { foo: "bar" },
          rawText: "{}",
        },
      });
      expect(result.id).toBe("artifact-1");
      expect(result.type).toBe("Plan");
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts ordered by createdAt desc, mapped to domain", async () => {
      const prisma = buildPrismaMock();
      prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "artifact-2" })]);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.id)).toEqual(["artifact-1", "artifact-2"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      const prisma = buildPrismaMock();
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId + type, ordered by version desc, and maps the result", async () => {
      const prisma = buildPrismaMock();
      prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ version: 3 }));
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Plan" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists", async () => {
      const prisma = buildPrismaMock();
      prisma.aiArtifact.findFirst.mockResolvedValue(null);
      const repo = new ArtifactRepository(prisma as never);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
