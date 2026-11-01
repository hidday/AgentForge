import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makePrisma() {
  return {
    aiRun: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("RunRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new RunRepository(prisma);
  });

  it("create() persists optional fields as null when omitted and maps the result", async () => {
    prisma.aiRun.create.mockResolvedValue(makeRow());
    const run = await repo.create({
      linearIssueId: "LIN-1",
      repo: "test-repo",
      workingDirectory: "/tmp",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
        state: "Todo",
      }),
    });
    expect(run.state).toBe(RunState.Todo);
    expect(run.id).toBe("run-1");
  });

  it("create() forwards provided optional fields", async () => {
    prisma.aiRun.create.mockResolvedValue(makeRow({ linearIssueTitle: "Title" }));
    await repo.create({
      linearIssueId: "LIN-1",
      linearIssueTitle: "Title",
      repo: "test-repo",
      workingDirectory: "/tmp",
    });
    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ linearIssueTitle: "Title" }),
    });
  });

  it("findAll() with no filter omits the where clause", async () => {
    prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
    const runs = await repo.findAll();
    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
    expect(runs).toHaveLength(1);
  });

  it("findAll() with a single state filters by exact state", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);
    await repo.findAll("Todo");
    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: "Todo" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll() with multiple comma-separated states filters with an `in` clause", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);
    await repo.findAll("Todo, Planning ,Implementing");
    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Todo", "Planning", "Implementing"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll() with an all-whitespace/empty filter string omits the where clause", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);
    await repo.findAll(" , ");
    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  it("findById() returns null when no row matches", async () => {
    prisma.aiRun.findUnique.mockResolvedValue(null);
    const run = await repo.findById("missing");
    expect(run).toBeNull();
  });

  it("findById() maps the row when found", async () => {
    prisma.aiRun.findUnique.mockResolvedValue(makeRow());
    const run = await repo.findById("run-1");
    expect(run?.id).toBe("run-1");
  });

  it("findByIssueId() returns null when no run exists for the issue", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(null);
    const run = await repo.findByIssueId("LIN-404");
    expect(run).toBeNull();
    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-404" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findByIssueId() maps the most recent matching run when one exists", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(makeRow({ linearIssueId: "LIN-1" }));
    const run = await repo.findByIssueId("LIN-1");
    expect(run?.linearIssueId).toBe("LIN-1");
  });

  it("findActiveByIssueId() excludes terminal states", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));
    const run = await repo.findActiveByIssueId("LIN-1");
    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-1", state: { notIn: ["Done", "Failed"] } },
      orderBy: { createdAt: "desc" },
    });
    expect(run?.state).toBe(RunState.Implementing);
  });

  it("findActiveByIssueId() returns null when only a terminal run exists", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(null);
    const run = await repo.findActiveByIssueId("LIN-1");
    expect(run).toBeNull();
  });

  it("updateState() persists the new state and returns the mapped run", async () => {
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Planning" }));
    const run = await repo.updateState("run-1", RunState.Planning);
    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: "Planning" },
    });
    expect(run.state).toBe(RunState.Planning);
  });

  it("findRunsNeedingLinearBackfill() queries for missing title or description", async () => {
    prisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);
    const runs = await repo.findRunsNeedingLinearBackfill();
    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(runs).toHaveLength(1);
  });

  it("findRunsNeedingLinearBackfill() returns an empty array when nothing needs backfill", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);
    const runs = await repo.findRunsNeedingLinearBackfill();
    expect(runs).toEqual([]);
  });

  it("update() forwards the partial patch as-is", async () => {
    prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/run-1", prNumber: 7 }));
    const run = await repo.update("run-1", { branchName: "ai/run-1", prNumber: 7 });
    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { branchName: "ai/run-1", prNumber: 7 },
    });
    expect(run.branchName).toBe("ai/run-1");
    expect(run.prNumber).toBe(7);
  });
});
