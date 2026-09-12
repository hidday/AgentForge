import { describe, it, expect, vi } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "a plan" },
    rawText: "raw plan text",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma() {
  const aiArtifact = {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  };
  return { aiArtifact } as unknown as PrismaClient & { aiArtifact: typeof aiArtifact };
}

describe("ArtifactRepository.create", () => {
  it("creates an artifact and maps the type/payload through", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.create.mockResolvedValue(makeRow());
    const repo = new ArtifactRepository(prisma);

    const result = await repo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { summary: "a plan" },
      rawText: "raw plan text",
    });

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { summary: "a plan" },
        rawText: "raw plan text",
      },
    });
    expect(result.id).toBe("artifact-1");
    expect(result.type).toBe("Plan");
    expect(result.payloadJson).toEqual({ summary: "a plan" });
  });
});

describe("ArtifactRepository.findByRunId", () => {
  it("orders by createdAt desc and maps every row", async () => {
    const prisma = makePrisma();
    const rows = [makeRow({ id: "a1" }), makeRow({ id: "a2" })];
    prisma.aiArtifact.findMany.mockResolvedValue(rows);
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findByRunId("run-1");

    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("returns an empty array when the run has no artifacts", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findMany.mockResolvedValue([]);
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findByRunId("run-empty");

    expect(result).toEqual([]);
  });
});

describe("ArtifactRepository.findLatestByType", () => {
  it("filters by runId and type, ordering by version desc", async () => {
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

  it("returns null when no artifact of that type exists", async () => {
    const prisma = makePrisma();
    prisma.aiArtifact.findFirst.mockResolvedValue(null);
    const repo = new ArtifactRepository(prisma);

    const result = await repo.findLatestByType("run-1", "Review");

    expect(result).toBeNull();
  });
});
