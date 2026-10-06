import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
    rawText: "raw text",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeMockPrisma() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe("ArtifactRepository", () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    mockPrisma = makeMockPrisma();
    repo = new ArtifactRepository(mockPrisma as never);
  });

  describe("create", () => {
    it("passes the params through to prisma and maps the returned row to an Artifact", async () => {
      const row = makeRow();
      mockPrisma.aiArtifact.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw text",
      });

      expect(mockPrisma.aiArtifact.create).toHaveBeenCalledWith({
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

    it("preserves arbitrary payloadJson shapes, including null", async () => {
      const row = makeRow({ payloadJson: null });
      mockPrisma.aiArtifact.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        type: "ChatMessage",
        version: 1,
        payloadJson: null,
        rawText: "",
      });

      expect(result.payloadJson).toBeNull();
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt desc and maps all rows", async () => {
      const rows = [makeRow({ id: "a" }), makeRow({ id: "b" })];
      mockPrisma.aiArtifact.findMany.mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(mockPrisma.aiArtifact.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.map((a) => a.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when the run has no artifacts", async () => {
      mockPrisma.aiArtifact.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-with-none");

      expect(result).toEqual([]);
    });
  });

  describe("findLatestByType", () => {
    it("queries by runId and type ordered by version desc", async () => {
      const row = makeRow({ version: 3 });
      mockPrisma.aiArtifact.findFirst.mockResolvedValue(row);

      const result = await repo.findLatestByType("run-1", "Plan");

      expect(mockPrisma.aiArtifact.findFirst).toHaveBeenCalledWith({
        where: { runId: "run-1", type: "Plan" },
        orderBy: { version: "desc" },
      });
      expect(result?.version).toBe(3);
    });

    it("returns null when no artifact of that type exists for the run", async () => {
      mockPrisma.aiArtifact.findFirst.mockResolvedValue(null);

      const result = await repo.findLatestByType("run-1", "Review");

      expect(result).toBeNull();
    });
  });
});
