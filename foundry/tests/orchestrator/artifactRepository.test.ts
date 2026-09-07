import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

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

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    aiArtifact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe("ArtifactRepository.create", () => {
  it("creates an artifact and maps the resulting row", async () => {
    const create = vi.fn().mockResolvedValue(makeRow());
    const prisma = makePrisma({ create });
    const repo = new ArtifactRepository(prisma);

    const artifact = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { foo: "bar" },
      rawText: "{}",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "{}",
      },
    });
    expect(artifact.id).toBe("artifact-1");
    expect(artifact.type).toBe("Plan");
  });
});

describe("ArtifactRepository.findByRunId", () => {
  it("returns artifacts ordered by createdAt desc, mapped to domain", async () => {
    const findMany = vi.fn().mockResolvedValue([makeRow(), makeRow({ id: "artifact-2" })]);
    const prisma = makePrisma({ findMany });
    const repo = new ArtifactRepository(prisma);

    const artifacts = await repo.findByRunId("run-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((a) => a.id)).toEqual(["artifact-1", "artifact-2"]);
  });

  it("returns an empty array when there are no artifacts", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new ArtifactRepository(prisma);

    expect(await repo.findByRunId("run-1")).toEqual([]);
  });
});

describe("ArtifactRepository.findLatestByType", () => {
  it("returns the mapped artifact when found", async () => {
    const findFirst = vi.fn().mockResolvedValue(makeRow({ version: 3 }));
    const prisma = makePrisma({ findFirst });
    const repo = new ArtifactRepository(prisma);

    const artifact = await repo.findLatestByType("run-1", "Plan");

    expect(findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Plan" },
      orderBy: { version: "desc" },
    });
    expect(artifact?.version).toBe(3);
  });

  it("returns null when no artifact of that type exists", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new ArtifactRepository(prisma);

    expect(await repo.findLatestByType("run-1", "Review")).toBeNull();
  });
});
