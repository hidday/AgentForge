import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "a plan" },
    rawText: "{}",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe("ArtifactRepository.create", () => {
  it("persists the artifact and casts the payload/type for Prisma", async () => {
    const prisma = buildPrismaMock();
    const row = makeRow();
    prisma.aiArtifact.create.mockResolvedValue(row);
    const repo = new ArtifactRepository(prisma as never);

    const artifact = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "a plan" },
      rawText: "{}",
    });

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "a plan" },
        rawText: "{}",
      },
    });
    expect(artifact.id).toBe("artifact-1");
    expect(artifact.type).toBe("Plan");
    expect(artifact.payloadJson).toEqual({ summary: "a plan" });
  });
});

describe("ArtifactRepository.findByRunId", () => {
  it("returns artifacts ordered by createdAt desc, mapped to domain objects", async () => {
    const prisma = buildPrismaMock();
    prisma.aiArtifact.findMany.mockResolvedValue([
      makeRow({ id: "a1", version: 2 }),
      makeRow({ id: "a2", version: 1 }),
    ]);
    const repo = new ArtifactRepository(prisma as never);

    const artifacts = await repo.findByRunId("run-1");

    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(artifacts.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("returns an empty array when the run has no artifacts", async () => {
    const prisma = buildPrismaMock();
    prisma.aiArtifact.findMany.mockResolvedValue([]);
    const repo = new ArtifactRepository(prisma as never);

    expect(await repo.findByRunId("run-1")).toEqual([]);
  });
});

describe("ArtifactRepository.findLatestByType", () => {
  it("queries by runId + type, ordered by version desc, and maps the row", async () => {
    const prisma = buildPrismaMock();
    const row = makeRow({ version: 3 });
    prisma.aiArtifact.findFirst.mockResolvedValue(row);
    const repo = new ArtifactRepository(prisma as never);

    const artifact = await repo.findLatestByType("run-1", "Plan");

    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Plan" },
      orderBy: { version: "desc" },
    });
    expect(artifact?.version).toBe(3);
  });

  it("returns null when no artifact of that type exists for the run", async () => {
    const prisma = buildPrismaMock();
    prisma.aiArtifact.findFirst.mockResolvedValue(null);
    const repo = new ArtifactRepository(prisma as never);

    expect(await repo.findLatestByType("run-1", "Review")).toBeNull();
  });
});
