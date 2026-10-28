import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactRepository } from "../../src/orchestrator/artifactRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "art-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { foo: "bar" },
    rawText: "raw",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("ArtifactRepository", () => {
  let prisma: {
    aiArtifact: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  let repo: ArtifactRepository;

  beforeEach(() => {
    prisma = {
      aiArtifact: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repo = new ArtifactRepository(prisma as any);
  });

  it("creates an artifact and maps the row to the domain shape", async () => {
    prisma.aiArtifact.create.mockResolvedValue(makeRow());

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
    expect(result).toEqual(makeRow());
  });

  it("findByRunId orders results by createdAt descending", async () => {
    prisma.aiArtifact.findMany.mockResolvedValue([makeRow(), makeRow({ id: "art-2" })]);

    const result = await repo.findByRunId("run-1");

    expect(prisma.aiArtifact.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(2);
  });

  it("findLatestByType returns null when nothing matches", async () => {
    prisma.aiArtifact.findFirst.mockResolvedValue(null);

    const result = await repo.findLatestByType("run-1", "Plan");

    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1", type: "Plan" },
      orderBy: { version: "desc" },
    });
    expect(result).toBeNull();
  });

  it("findLatestByType returns the mapped artifact when found", async () => {
    prisma.aiArtifact.findFirst.mockResolvedValue(makeRow({ version: 3 }));

    const result = await repo.findLatestByType("run-1", "Plan");

    expect(result?.version).toBe(3);
  });
});
