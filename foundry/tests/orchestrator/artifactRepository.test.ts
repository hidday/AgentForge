import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "a plan" },
    rawText: "{}",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function buildPrisma() {
  const aiArtifact = {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  };
  const prisma = { aiArtifact } as unknown as PrismaClient;
  return { prisma, aiArtifact };
}

describe("ArtifactRepository", () => {
  let prisma: PrismaClient;
  let aiArtifact: ReturnType<typeof buildPrisma>["aiArtifact"];
  let repo: ArtifactRepository;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    aiArtifact = built.aiArtifact;
    repo = new ArtifactRepository(prisma);
  });

  describe("create", () => {
    it("creates with the given fields, casting payloadJson to object", async () => {
      aiArtifact.create.mockResolvedValue(makeRow());

      await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "a plan" },
        rawText: "{}",
      });

      expect(aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "a plan" },
          rawText: "{}",
        },
      });
    });

    it("maps the created row to a domain Artifact", async () => {
      aiArtifact.create.mockResolvedValue(makeRow({ id: "artifact-new", type: "Review" }));

      const result = await repo.create({
        runId: "run-1",
        type: "Review",
        version: 2,
        payloadJson: {},
        rawText: "text",
      });

      expect(result.id).toBe("artifact-new");
      expect(result.type).toBe("Review");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt desc", async () => {
      aiArtifact.findMany.mockResolvedValue([]);

      await repo.findByRunId("run-1");

      expect(aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps all returned rows to domain Artifacts", async () => {
      aiArtifact.findMany.mockResolvedValue([
        makeRow({ id: "a1" }),
        makeRow({ id: "a2", type: "Review" }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(result.map((a) => a.id)).toEqual(["a1", "a2"]);
      expect(result[1]?.type).toBe("Review");
    });

    it("returns an empty array when the run has no artifacts", async () => {
      aiArtifact.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type, ordered by version desc", async () => {
      aiArtifact.findFirst.mockResolvedValue(makeRow());

      await repo.findLatestByType("run-1", "Plan");

      expect(aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Plan" },
        orderBy: { version: "desc" },
      });
    });

    it("returns null when no artifact of that type exists", async () => {
      aiArtifact.findFirst.mockResolvedValue(null);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });

    it("maps the found row to a domain Artifact", async () => {
      aiArtifact.findFirst.mockResolvedValue(makeRow({ id: "latest", version: 5, type: "Plan" }));

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(result?.id).toBe("latest");
      expect(result?.version).toBe(5);
    });
  });
});
