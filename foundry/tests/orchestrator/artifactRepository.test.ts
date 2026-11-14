import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "art-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "s" },
    rawText: "raw",
    createdAt: new Date("2026-01-01"),
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

  it("create() persists the artifact and maps the result to the domain shape", async () => {
    prisma.aiArtifact.create.mockResolvedValue(makeRow());

    const artifact = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "s" },
      rawText: "raw",
    });

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "s" },
        rawText: "raw",
      },
    });
    expect(artifact.type).toBe("Plan");
  });

  it("findByRunId() returns artifacts ordered by most recent first", async () => {
    prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "art-2" })]);

    const artifacts = await repo.findByRunId("run-1");

    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(artifacts).toHaveLength(2);
  });

  it("findByRunId() returns an empty array when there are no artifacts", async () => {
    prisma.aiArtifact.findMany.mockResolvedValue([]);
    expect(await repo.findByRunId("run-missing")).toEqual([]);
  });

  it("findLatestByType() returns the newest version of a given type, or null", async () => {
    prisma.aiArtifact.findFirst.mockResolvedValue(null);
    expect(await repo.findLatestByType("run-1", "Plan")).toBeNull();

    prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ version: 3 }));
    const artifact = await repo.findLatestByType("run-1", "Plan");
    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Plan" },
      orderBy: { version: "desc" },
    });
    expect(artifact?.version).toBe(3);
  });
});
