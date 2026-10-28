import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("RunRepository", () => {
  let prisma: {
    aiRun: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let repo: RunRepository;

  beforeEach(() => {
    prisma = {
      aiRun: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repo = new RunRepository(prisma as any);
  });

  it("creates a run with defaulted optional fields and Todo state", async () => {
    prisma.aiRun.create.mockResolvedValue(makeRow());

    const result = await repo.create({
      linearIssueId: "lin-1",
      repo: "org/repo",
      workingDirectory: "/tmp/work",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueId: "lin-1",
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
        state: "Todo",
      }),
    });
    expect(result.id).toBe("run-1");
    expect(result.state).toBe(RunState.Todo);
  });

  it("findAll with no filter passes undefined where clause", async () => {
    prisma.aiRun.findMany.mockResolvedValue([makeRow()]);

    const result = await repo.findAll();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(1);
  });

  it("findAll with a single state filters by exact state", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);

    await repo.findAll("Todo");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: "Todo" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll with multiple comma-separated states filters by `in`", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);

    await repo.findAll("Todo, Planning ,Done");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Todo", "Planning", "Done"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll with an empty/whitespace-only filter leaves where undefined", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);

    await repo.findAll("  ");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  it("findById returns null when no row is found", async () => {
    prisma.aiRun.findUnique.mockResolvedValue(null);

    const result = await repo.findById("missing");

    expect(result).toBeNull();
  });

  it("findById returns the mapped run when found", async () => {
    prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-2" }));

    const result = await repo.findById("run-2");

    expect(result?.id).toBe("run-2");
  });

  it("findByIssueId returns the most recent matching run or null", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(null);
    expect(await repo.findByIssueId("lin-9")).toBeNull();

    prisma.aiRun.findFirst.mockResolvedValue(makeRow());
    const result = await repo.findByIssueId("lin-1");
    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "lin-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result?.id).toBe("run-1");
  });

  it("findActiveByIssueId excludes terminal states (Done, Failed)", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(makeRow());

    await repo.findActiveByIssueId("lin-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "lin-1",
        state: { notIn: ["Done", "Failed"] },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("updateState persists the new state and returns the mapped run", async () => {
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Implementing" }));

    const result = await repo.updateState("run-1", RunState.Implementing);

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: "Implementing" },
    });
    expect(result.state).toBe(RunState.Implementing);
  });

  it("findRunsNeedingLinearBackfill queries for missing title or description", async () => {
    prisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);

    const result = await repo.findRunsNeedingLinearBackfill();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(result).toHaveLength(1);
  });

  it("update forwards the partial patch and returns the mapped run", async () => {
    prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "feature/x" }));

    const result = await repo.update("run-1", { branchName: "feature/x" });

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { branchName: "feature/x" },
    });
    expect(result.branchName).toBe("feature/x");
  });
});
