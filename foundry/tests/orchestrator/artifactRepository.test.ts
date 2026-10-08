import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "plan" },
    rawText: "{}",
    createdAt: new Date("2024-01-01T00:00:00Z"),
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
  it("create() persists the artifact fields and returns the mapped domain artifact", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.create.mockResolvedValue(makeRow());
    const repo = new ArtifactRepository(prisma as never);

    const artifact = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "plan" },
      rawText: "{}",
    });

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "plan" },
        rawText: "{}",
      },
    });
    expect(artifact.id).toBe("artifact-1");
    expect(artifact.type).toBe("Plan");
  });

  it("findByRunId() returns artifacts ordered newest first", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "artifact-2" })]);
    const repo = new ArtifactRepository(prisma as never);

    const artifacts = await repo.findByRunId("run-1");

    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(artifacts).toHaveLength(2);
  });

  it("findLatestByType() returns the highest-version artifact of the given type", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ version: 3 }));
    const repo = new ArtifactRepository(prisma as never);

    const artifact = await repo.findLatestByType("run-1", "Plan");

    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Plan" },
      orderBy: { version: "desc" },
    });
    expect(artifact?.version).toBe(3);
  });

  it("findLatestByType() returns null when no artifact of that type exists", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findFirst.mockResolvedValue(null);
    const repo = new ArtifactRepository(prisma as never);

    const artifact = await repo.findLatestByType("run-1", "Review");

    expect(artifact).toBeNull();
  });
});
