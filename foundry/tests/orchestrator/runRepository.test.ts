import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: null,
    repo: "test/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function makePrismaMock() {
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
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new RunRepository(prisma);
  });

  it("create() persists a new run with Todo state and maps the row back to the domain shape", async () => {
    prisma.aiRun.create.mockResolvedValue(makeRow());
    const run = await repo.create({
      linearIssueId: "lin-1",
      repo: "test/repo",
      workingDirectory: "/tmp/repo",
    });
    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ linearIssueId: "lin-1", state: "Todo" }),
    });
    expect(run.state).toBe(RunState.Todo);
    expect(run.id).toBe("run-1");
  });

  it("create() defaults optional fields to null when omitted", async () => {
    prisma.aiRun.create.mockResolvedValue(makeRow());
    await repo.create({ linearIssueId: "lin-1", repo: "test/repo", workingDirectory: "/tmp/repo" });
    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      }),
    });
  });

  it("findAll() with no filter queries without a where clause", async () => {
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

  it("findAll() with a comma-separated list filters by `in`", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);
    await repo.findAll("Todo, Planning");
    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Todo", "Planning"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll() with an empty filter string behaves like no filter", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);
    await repo.findAll("");
    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  it("findById() returns null when the run does not exist", async () => {
    prisma.aiRun.findUnique.mockResolvedValue(null);
    const run = await repo.findById("missing");
    expect(run).toBeNull();
  });

  it("findById() maps a found row to the domain shape", async () => {
    prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-2" }));
    const run = await repo.findById("run-2");
    expect(run?.id).toBe("run-2");
  });

  it("findByIssueId() returns the most recent run or null", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(null);
    expect(await repo.findByIssueId("lin-1")).toBeNull();
    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "lin-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findActiveByIssueId() excludes terminal states", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));
    const run = await repo.findActiveByIssueId("lin-1");
    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "lin-1", state: { notIn: ["Done", "Failed"] } },
      orderBy: { createdAt: "desc" },
    });
    expect(run?.state).toBe(RunState.Implementing);
  });

  it("updateState() persists the new state and returns the mapped run", async () => {
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Planning" }));
    const run = await repo.updateState("run-1", RunState.Planning);
    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: RunState.Planning },
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

  it("update() persists a partial patch and returns the mapped run", async () => {
    prisma.aiRun.update.mockResolvedValue(makeRow({ prNumber: 42 }));
    const run = await repo.update("run-1", { prNumber: 42 });
    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { prNumber: 42 },
    });
    expect(run.prNumber).toBe(42);
  });
});
