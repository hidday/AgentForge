import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
    rawText: "raw text",
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
  } as unknown as PrismaClient;
}

describe("ArtifactRepository", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new ArtifactRepository(prisma);
  });

  describe("create", () => {
    it("creates an artifact and returns the mapped domain object", async () => {
      const row = makeRow();
      (prisma.aiArtifact.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw text",
      });

      expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { foo: "bar" },
          rawText: "raw text",
        },
      });
      expect(result).toEqual({
        id: "artifact-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw text",
        createdAt: row.createdAt,
      });
    });
  });

  describe("findByRunId", () => {
    it("returns artifacts ordered by newest first, mapped to domain objects", async () => {
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ id: "a", version: 2 }),
        makeRow({ id: "b", version: 1 }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      (prisma.aiArtifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("returns the mapped artifact when one exists, ordered by highest version", async () => {
      const row = makeRow({ type: "Review", version: 3 });
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Review" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
      expect(result?.type).toBe("Review");
    });

    it("returns null when no artifact of that type exists for the run", async () => {
      (prisma.aiArtifact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
