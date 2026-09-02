import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "hello" },
    rawText: "{}",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
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
  it("persists the artifact and maps the row back to the domain shape", async () => {
    const row = makeRow();
    const create = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ create });
    const repo = new ArtifactRepository(prisma);

    const result = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "hello" },
      rawText: "{}",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "hello" },
        rawText: "{}",
      },
    });
    expect(result).toEqual({
      id: "artifact-1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "hello" },
      rawText: "{}",
      createdAt: row.createdAt,
    });
  });

  it("passes through arbitrary payloadJson shapes untouched", async () => {
    const payload = { nested: { a: [1, 2, 3] }, flag: true };
    const row = makeRow({ payloadJson: payload });
    const create = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ create });
    const repo = new ArtifactRepository(prisma);

    const result = await repo.create({
      runId: "run-1",
      type: "Review",
      version: 2,
      payloadJson: payload,
      rawText: "raw",
    });

    expect(result.payloadJson).toEqual(payload);
  });
});

describe("ArtifactRepository.findByRunId", () => {
  it("returns all artifacts for a run ordered by most recent first, mapped to domain shape", async () => {
    const rows = [makeRow({ id: "a2", version: 2 }), makeRow({ id: "a1", version: 1 })];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = makePrisma({ findMany });
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findByRunId("run-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("a2");
    expect(result[1].id).toBe("a1");
  });

  it("returns an empty array when the run has no artifacts", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findByRunId("run-none");

    expect(result).toEqual([]);
  });
});

describe("ArtifactRepository.findLatestByType", () => {
  it("returns the highest-version artifact of the given type", async () => {
    const row = makeRow({ version: 5, type: "Review" });
    const findFirst = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ findFirst });
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findLatestByType("run-1", "Review");

    expect(findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Review" },
      orderBy: { version: "desc" },
    });
    expect(result?.version).toBe(5);
    expect(result?.type).toBe("Review");
  });

  it("returns null when no artifact of that type exists for the run", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findLatestByType("run-1", "Skill");

    expect(result).toBeNull();
  });
});
