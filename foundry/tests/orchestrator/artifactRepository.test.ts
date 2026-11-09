import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "plan" },
    rawText: '{"summary":"plan"}',
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("ArtifactRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new ArtifactRepository(prisma);
  });

  describe("create", () => {
    it("passes all fields through to prisma and maps the resulting row", async () => {
      (prisma.aiArtifact.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "plan" },
        rawText: '{"summary":"plan"}',
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { summary: "plan" },
          rawText: '{"summary":"plan"}',
        },
      });
      expect(result.id).toBe("artifact-1");
      expect(result.type).toBe("Plan");
      expect(result.payloadJson).toEqual({ summary: "plan" });
    });
  });

  describe("findByRunId", () => {
    it("queries all artifacts for a run ordered newest first", async () => {
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ id: "a1", version: 2 }),
        makeRow({ id: "a2", version: 1 }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a1", "a2"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByRunId("run-1");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version descending", async () => {
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ type: "Review", version: 3 }),
      );

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
      expect(result?.type).toBe("Review");
    });

    it("returns null when there is no artifact of the requested type", async () => {
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });

    it("maps payloadJson through unchanged, including non-object payloads", async () => {
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ payloadJson: null }),
      );

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(result?.payloadJson).toBeNull();
    });
  });
});
