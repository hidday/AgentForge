import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "li-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "agentforge",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/repo",
    latestArtifactVersion: 0,
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
  };
}

describe("RunRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new RunRepository(prisma as never);
  });

  it("create() persists a Todo-state run with optional fields defaulted to null", async () => {
    prisma.aiRun.create.mockResolvedValue(makeRow());

    const run = await repo.create({
      linearIssueId: "li-1",
      repo: "agentforge",
      workingDirectory: "/repo",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueId: "li-1",
        linearIssueIdentifier: null,
        state: "Todo",
      }),
    });
    expect(run.state).toBe(RunState.Todo);
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

  it("findAll() with a single state filters by that exact state", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);

    await repo.findAll("Todo");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: "Todo" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll() with multiple comma-separated states filters with an 'in' clause", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);

    await repo.findAll("Todo, Planning");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Todo", "Planning"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll() ignores an empty filter string", async () => {
    prisma.aiRun.findMany.mockResolvedValue([]);

    await repo.findAll("");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  it("findById() returns null when no row is found", async () => {
    prisma.aiRun.findUnique.mockResolvedValue(null);
    expect(await repo.findById("missing")).toBeNull();
  });

  it("findById() maps a found row to the domain Run", async () => {
    prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-2" }));
    const run = await repo.findById("run-2");
    expect(run?.id).toBe("run-2");
  });

  it("findByIssueId() returns the most recent run for the issue, or null", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(null);
    expect(await repo.findByIssueId("li-1")).toBeNull();

    prisma.aiRun.findFirst.mockResolvedValue(makeRow());
    const run = await repo.findByIssueId("li-1");
    expect(run?.linearIssueId).toBe("li-1");
  });

  it("findActiveByIssueId() excludes terminal states from the query", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(null);

    await repo.findActiveByIssueId("li-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "li-1",
        state: { notIn: ["Done", "Failed"] },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("updateState() writes the new state and returns the mapped run", async () => {
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Planning" }));

    const run = await repo.updateState("run-1", RunState.Planning);

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: "Planning" },
    });
    expect(run.state).toBe(RunState.Planning);
  });

  it("findRunsNeedingLinearBackfill() queries for missing title or description", async () => {
    prisma.aiRun.findMany.mockResolvedValue([makeRow()]);

    const runs = await repo.findRunsNeedingLinearBackfill();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(runs).toHaveLength(1);
  });

  it("update() applies a partial patch and returns the mapped run", async () => {
    prisma.aiRun.update.mockResolvedValue(makeRow({ prNumber: 5 }));

    const run = await repo.update("run-1", { prNumber: 5 });

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { prNumber: 5 },
    });
    expect(run.prNumber).toBe(5);
  });
});
