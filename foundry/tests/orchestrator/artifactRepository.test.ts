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

function makePrisma() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe("ArtifactRepository", () => {
  it("create() maps the created row to the domain Artifact shape", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.create.mockResolvedValue(makeRow());
    const repo = new ArtifactRepository(prisma as never);

    const artifact = await repo.create({
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
    expect(artifact).toEqual(makeRow());
  });

  it("findByRunId returns artifacts ordered by createdAt desc", async () => {
    const prisma = makePrisma();
    const rows = [makeRow({ id: "a1" }), makeRow({ id: "a2" })];
    prisma.aiArtifact.findMany.mockResolvedValue(rows);
    const repo = new ArtifactRepository(prisma as never);

    const result = await repo.findByRunId("run-1");

    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("findLatestByType returns the mapped artifact when found", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ type: "Review" }));
    const repo = new ArtifactRepository(prisma as never);

    const result = await repo.findLatestByType("run-1", "Review");

    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Review" },
      orderBy: { version: "desc" },
    });
    expect(result?.type).toBe("Review");
  });

  it("findLatestByType returns null when no artifact of that type exists", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findFirst.mockResolvedValue(null);
    const repo = new ArtifactRepository(prisma as never);

    const result = await repo.findLatestByType("run-1", "Review");

    expect(result).toBeNull();
  });
});
