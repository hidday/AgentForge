import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "x" },
    rawText: "raw",
    createdAt: new Date("2024-01-01"),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("ArtifactRepository", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new ArtifactRepository(prisma);
  });

  it("create() persists the artifact and maps the row back to the domain shape", async () => {
    prisma.aiArtifact.create.mockResolvedValue(makeRow());
    const artifact = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "x" },
      rawText: "raw",
    });
    expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "x" },
        rawText: "raw",
      },
    });
    expect(artifact.type).toBe("Plan");
  });

  it("findByRunId() orders by version descending (newest first)", async () => {
    prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "artifact-2", version: 0 })]);
    const artifacts = await repo.findByRunId("run-1");
    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(artifacts).toHaveLength(2);
  });

  it("findLatestByType() returns the highest version of a given type", async () => {
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
