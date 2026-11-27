import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
    rawText: '{"foo":"bar"}',
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildRepo() {
  const prisma = {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  const repo = new ArtifactRepository(prisma as never);
  return { repo, prisma };
}

describe("ArtifactRepository.create", () => {
  it("creates an artifact and returns the mapped domain object", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiArtifact.create.mockResolvedValue(makeRow());

    const artifact = await repo.create({
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
    expect(artifact.id).toBe("artifact-1");
    expect(artifact.type).toBe("Plan");
    expect(artifact.payloadJson).toEqual({ foo: "bar" });
  });
});

describe("ArtifactRepository.findByRunId", () => {
  it("queries by runId ordered by createdAt desc and maps all rows", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiArtifact.findMany.mockResolvedValue([
      makeRow({ id: "a1", version: 2 }),
      makeRow({ id: "a2", version: 1 }),
    ]);

    const artifacts = await repo.findByRunId("run-1");

    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("returns an empty array when there are no artifacts", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiArtifact.findMany.mockResolvedValue([]);

    expect(await repo.findByRunId("run-1")).toEqual([]);
  });
});

describe("ArtifactRepository.findLatestByType", () => {
  it("queries by runId + type ordered by version desc and returns the mapped row", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ type: "Review", version: 3 }));

    const artifact = await repo.findLatestByType("run-1", "Review");

    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Review" },
      orderBy: { version: "desc" },
    });
    expect(artifact?.version).toBe(3);
  });

  it("returns null when no artifact of that type exists", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiArtifact.findFirst.mockResolvedValue(null);

    expect(await repo.findLatestByType("run-1", "Review")).toBeNull();
  });
});
