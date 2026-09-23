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
    rawText: "{}",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrisma() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe("ArtifactRepository", () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = buildPrisma();
    repo = new ArtifactRepository(prisma as unknown as PrismaClient);
  });

  describe("create", () => {
    it("creates an artifact and maps the resulting row", async () => {
      prisma.aiArtifact.create.mockResolvedValue(makeRow());
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
    it("returns artifacts ordered by createdAt desc, mapped", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "artifact-2" })]);
      const result = await repo.findByRunId("run-1");
      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.id)).toEqual(["artifact-1", "artifact-2"]);
    });

    it("returns an empty array when there are none", async () => {
      prisma.aiArtifact.findMany.mockResolvedValue([]);
      const result = await repo.findByRunId("run-1");
      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("returns the mapped artifact when found", async () => {
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
