import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
    rawText: "raw",
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("ArtifactRepository", () => {
  it("create() forwards params and maps the returned row", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.create.mockResolvedValue(makeRow());
    const repo = new ArtifactRepository(prisma);

    const result = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { foo: "bar" },
      rawText: "raw",
    });

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "raw",
      },
    });
    expect(result).toEqual(expect.objectContaining({ id: "artifact-1", type: "Plan" }));
  });

  it("findByRunId() orders by createdAt desc and maps every row", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "artifact-2" })]);
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findByRunId("run-1");

    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result.map((a) => a.id)).toEqual(["artifact-1", "artifact-2"]);
  });

  it("findByRunId() returns an empty array when there are none", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findMany.mockResolvedValue([]);
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findByRunId("run-missing");

    expect(result).toEqual([]);
  });

  it("findLatestByType() queries by runId+type ordered by version desc, and maps when found", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ version: 3 }));
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findLatestByType("run-1", "Plan");

    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Plan" },
      orderBy: { version: "desc" },
    });
    expect(result?.version).toBe(3);
  });

  it("findLatestByType() returns null when no artifact of that type exists", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findFirst.mockResolvedValue(null);
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findLatestByType("run-1", "Review");

    expect(result).toBeNull();
  });
});
