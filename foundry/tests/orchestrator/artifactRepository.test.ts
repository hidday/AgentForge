import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makePrisma(
  overrides: Partial<{ create: unknown; findMany: unknown; findFirst: unknown }> = {},
) {
  return {
    aiArtifact: {
      create: overrides.create ?? vi.fn(),
      findMany: overrides.findMany ?? vi.fn(),
      findFirst: overrides.findFirst ?? vi.fn(),
    },
  } as unknown as import("../../src/generated/prisma/client.js").PrismaClient;
}

describe("ArtifactRepository", () => {
  it("creates an artifact and maps the type through to the domain shape", async () => {
    const createdAt = new Date("2024-01-01T00:00:00Z");
    const create = vi.fn().mockResolvedValue({
      id: "art-1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "x" },
      rawText: "raw",
      createdAt,
    });
    const prisma = makePrisma({ create });
    const repo = new ArtifactRepository(prisma);

    const result = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "x" },
      rawText: "raw",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "x" },
        rawText: "raw",
      },
    });
    expect(result).toEqual({
      id: "art-1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "x" },
      rawText: "raw",
      createdAt,
    });
  });

  it("finds all artifacts for a run ordered descending by createdAt", async () => {
    const rows = [
      {
        id: "1",
        runId: "run-1",
        type: "Plan",
        version: 2,
        payloadJson: null,
        rawText: "",
        createdAt: new Date(2),
      },
      {
        id: "2",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: null,
        rawText: "",
        createdAt: new Date(1),
      },
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = makePrisma({ findMany });
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findByRunId("run-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(2);
  });

  it("finds the latest artifact of a given type", async () => {
    const row = {
      id: "art-5",
      runId: "run-1",
      type: "Review",
      version: 5,
      payloadJson: null,
      rawText: "",
      createdAt: new Date(),
    };
    const findFirst = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ findFirst });
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findLatestByType("run-1", "Review");

    expect(findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Review" },
      orderBy: { version: "desc" },
    });
    expect(result?.id).toBe("art-5");
  });

  it("returns null when no artifact of the given type exists", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findLatestByType("run-1", "Review");

    expect(result).toBeNull();
  });
});
