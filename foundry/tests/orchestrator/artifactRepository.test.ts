import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function buildPrisma() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe("ArtifactRepository.create", () => {
  it("creates an artifact and returns the mapped domain row with the cast type", async () => {
    const prisma = buildPrisma();
    const createdAt = new Date("2026-01-01T00:00:00Z");
    prisma.aiArtifact.create.mockResolvedValue({
      id: "art-1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "test" },
      rawText: "{}",
      createdAt,
    });

    const repo = new ArtifactRepository(prisma as never);
    const result = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "test" },
      rawText: "{}",
    });

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "test" },
        rawText: "{}",
      },
    });
    expect(result).toEqual({
      id: "art-1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "test" },
      rawText: "{}",
      createdAt,
    });
  });
});

describe("ArtifactRepository.findByRunId", () => {
  it("queries by runId ordered descending by createdAt and maps every row", async () => {
    const prisma = buildPrisma();
    const rows = [
      {
        id: "art-2",
        runId: "run-1",
        type: "Review",
        version: 2,
        payloadJson: { verdict: "approved" },
        rawText: "{}",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
      {
        id: "art-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "test" },
        rawText: "{}",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];
    prisma.aiArtifact.findMany.mockResolvedValue(rows);

    const repo = new ArtifactRepository(prisma as never);
    const result = await repo.findByRunId("run-1");

    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["art-2", "art-1"]);
    expect(result[0].type).toBe("Review");
  });

  it("returns an empty array when there are no matching artifacts", async () => {
    const prisma = buildPrisma();
    prisma.aiArtifact.findMany.mockResolvedValue([]);

    const repo = new ArtifactRepository(prisma as never);
    const result = await repo.findByRunId("run-empty");

    expect(result).toEqual([]);
  });
});

describe("ArtifactRepository.findLatestByType", () => {
  it("queries by runId and type ordered by version desc, and maps the found row", async () => {
    const prisma = buildPrisma();
    const createdAt = new Date("2026-01-03T00:00:00Z");
    prisma.aiArtifact.findFirst.mockResolvedValue({
      id: "art-3",
      runId: "run-1",
      type: "Plan",
      version: 3,
      payloadJson: { summary: "latest" },
      rawText: "{}",
      createdAt,
    });

    const repo = new ArtifactRepository(prisma as never);
    const result = await repo.findLatestByType("run-1", "Plan");

    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Plan" },
      orderBy: { version: "desc" },
    });
    expect(result).toEqual({
      id: "art-3",
      runId: "run-1",
      type: "Plan",
      version: 3,
      payloadJson: { summary: "latest" },
      rawText: "{}",
      createdAt,
    });
  });

  it("returns null when no artifact of that type exists for the run", async () => {
    const prisma = buildPrisma();
    prisma.aiArtifact.findFirst.mockResolvedValue(null);

    const repo = new ArtifactRepository(prisma as never);
    const result = await repo.findLatestByType("run-1", "Review");

    expect(result).toBeNull();
  });
});
