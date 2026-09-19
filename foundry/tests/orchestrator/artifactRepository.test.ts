import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function buildPrisma() {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

const baseRow = {
  id: "artifact-1",
  runId: "run-1",
  type: "Plan",
  version: 1,
  payloadJson: { foo: "bar" },
  rawText: "{}",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("ArtifactRepository", () => {
  it("create() persists the artifact via prisma.aiArtifact.create and returns the domain object", async () => {
    const prisma = buildPrisma();
    prisma.aiArtifact.create.mockResolvedValue(baseRow);
    const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

    const result = await repo.create({
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
    expect(result).toEqual({
      id: "artifact-1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { foo: "bar" },
      rawText: "{}",
      createdAt: baseRow.createdAt,
    });
  });

  it("findByRunId() returns artifacts ordered by createdAt desc, mapped to domain objects", async () => {
    const prisma = buildPrisma();
    const rows = [baseRow, { ...baseRow, id: "artifact-2", version: 2 }];
    prisma.aiArtifact.findMany.mockResolvedValue(rows);
    const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

    const result = await repo.findByRunId("run-1");

    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("artifact-1");
    expect(result[1].id).toBe("artifact-2");
  });

  it("findByRunId() returns an empty array when there are no artifacts", async () => {
    const prisma = buildPrisma();
    prisma.aiArtifact.findMany.mockResolvedValue([]);
    const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

    const result = await repo.findByRunId("run-none");

    expect(result).toEqual([]);
  });

  it("findLatestByType() returns the mapped artifact when found", async () => {
    const prisma = buildPrisma();
    prisma.aiArtifact.findFirst.mockResolvedValue(baseRow);
    const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

    const result = await repo.findLatestByType("run-1", "Plan");

    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Plan" },
      orderBy: { version: "desc" },
    });
    expect(result?.id).toBe("artifact-1");
  });

  it("findLatestByType() returns null when no matching artifact exists", async () => {
    const prisma = buildPrisma();
    prisma.aiArtifact.findFirst.mockResolvedValue(null);
    const repo = new ArtifactRepository(prisma as unknown as PrismaClient);

    const result = await repo.findLatestByType("run-1", "Review");

    expect(result).toBeNull();
  });
});
