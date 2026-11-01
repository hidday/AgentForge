import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "ok" },
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("ArtifactRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new ArtifactRepository(prisma);
  });

  it("create() persists the artifact and maps the row back to the domain type", async () => {
    prisma.aiArtifact.create.mockResolvedValue(makeRow());
    const artifact = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "ok" },
      rawText: "raw",
    });

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "ok" },
        rawText: "raw",
      },
    });
    expect(artifact.id).toBe("artifact-1");
    expect(artifact.type).toBe("Plan");
  });

  it("findByRunId() orders by createdAt desc and maps every row", async () => {
    prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "artifact-2" })]);
    const artifacts = await repo.findByRunId("run-1");
    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(artifacts.map((a) => a.id)).toEqual(["artifact-1", "artifact-2"]);
  });

  it("findByRunId() returns an empty array when the run has no artifacts", async () => {
    prisma.aiArtifact.findMany.mockResolvedValue([]);
    expect(await repo.findByRunId("run-404")).toEqual([]);
  });

  it("findLatestByType() returns the mapped row ordered by version desc", async () => {
    prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ version: 3 }));
    const artifact = await repo.findLatestByType("run-1", "Plan");
    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Plan" },
      orderBy: { version: "desc" },
    });
    expect(artifact?.version).toBe(3);
  });

  it("findLatestByType() returns null when no artifact of that type exists", async () => {
    prisma.aiArtifact.findFirst.mockResolvedValue(null);
    expect(await repo.findLatestByType("run-1", "Review")).toBeNull();
  });
});
