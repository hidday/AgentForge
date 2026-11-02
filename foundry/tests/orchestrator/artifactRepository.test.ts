import { describe, it, expect, vi, beforeEach } from "vitest";
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
  let prisma: ReturnType<typeof makePrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new ArtifactRepository(prisma as never);
  });

  it("creates an artifact with the given params", async () => {
    prisma.aiArtifact.create.mockResolvedValue(makeRow());
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
    expect(artifact.id).toBe("artifact-1");
    expect(artifact.payloadJson).toEqual({ foo: "bar" });
  });

  it("findByRunId returns all artifacts for a run, newest first", async () => {
    prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "artifact-2" })]);
    const artifacts = await repo.findByRunId("run-1");
    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(artifacts).toHaveLength(2);
  });

  it("findLatestByType returns the mapped artifact when found", async () => {
    prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ version: 3 }));
    const artifact = await repo.findLatestByType("run-1", "Plan");
    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Plan" },
      orderBy: { version: "desc" },
    });
    expect(artifact?.version).toBe(3);
  });

  it("findLatestByType returns null when no artifact exists", async () => {
    prisma.aiArtifact.findFirst.mockResolvedValue(null);
    const artifact = await repo.findLatestByType("run-1", "Review");
    expect(artifact).toBeNull();
  });
});
