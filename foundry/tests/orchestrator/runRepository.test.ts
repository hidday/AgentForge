import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
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
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
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
  it("create() persists a new run with Todo state and maps the row back to a domain Run", async () => {
    const prisma = makePrisma();
    prisma.aiRun.create.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma as never);

    const run = await repo.create({
      linearIssueId: "LIN-1",
      repo: "test-repo",
      workingDirectory: "/tmp/repo",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/repo",
        state: "Todo",
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      }),
    });
    expect(run.id).toBe("run-1");
    expect(run.state).toBe(RunState.Todo);
  });

  it("create() forwards optional Linear metadata when provided", async () => {
    const prisma = makePrisma();
    prisma.aiRun.create.mockResolvedValue(makeRow({ linearIssueIdentifier: "LIN-1" }));
    const repo = new RunRepository(prisma as never);

    await repo.create({
      linearIssueId: "LIN-1",
      linearIssueIdentifier: "LIN-1",
      linearIssueDescription: "desc",
      linearIssueTitle: "title",
      linearIssueUrl: "https://linear.app/x",
      repo: "test-repo",
      workingDirectory: "/tmp/repo",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
      }),
    });
  });

  it("findAll() with no filter queries without a where clause, newest first", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
    const repo = new RunRepository(prisma as never);

    const runs = await repo.findAll();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
    expect(runs).toHaveLength(1);
  });

  it("findAll() with a single state filters by exact state", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma as never);

    await repo.findAll("Todo");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: "Todo" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll() with multiple comma-separated states filters with an 'in' clause, trimming whitespace", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma as never);

    await repo.findAll("Todo, Planning ,Done");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Todo", "Planning", "Done"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll() with an empty/blank filter string treats it as no filter", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma as never);

    await repo.findAll(" , ");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  it("findById() returns null when no row matches", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findUnique.mockResolvedValue(null);
    const repo = new RunRepository(prisma as never);

    const run = await repo.findById("missing");

    expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "missing" } });
    expect(run).toBeNull();
  });

  it("findById() maps a found row to a domain Run", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-42" }));
    const repo = new RunRepository(prisma as never);

    const run = await repo.findById("run-42");

    expect(run?.id).toBe("run-42");
  });

  it("findByIssueId() returns the most recent run for the issue, or null", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma as never);

    const run = await repo.findByIssueId("LIN-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(run?.linearIssueId).toBe("LIN-1");
  });

  it("findActiveByIssueId() excludes terminal states (Done, Failed)", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findFirst.mockResolvedValue(null);
    const repo = new RunRepository(prisma as never);

    const run = await repo.findActiveByIssueId("LIN-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "LIN-1",
        state: { notIn: ["Done", "Failed"] },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(run).toBeNull();
  });

  it("updateState() persists the new state and returns the mapped run", async () => {
    const prisma = makePrisma();
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Planning" }));
    const repo = new RunRepository(prisma as never);

    const run = await repo.updateState("run-1", RunState.Planning);

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: "Planning" },
    });
    expect(run.state).toBe(RunState.Planning);
  });

  it("findRunsNeedingLinearBackfill() queries runs missing title or description", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([makeRow(), makeRow({ id: "run-2" })]);
    const repo = new RunRepository(prisma as never);

    const runs = await repo.findRunsNeedingLinearBackfill();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(runs).toHaveLength(2);
  });

  it("update() persists a partial patch and returns the mapped run", async () => {
    const prisma = makePrisma();
    prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/run-1", prNumber: 7 }));
    const repo = new RunRepository(prisma as never);

    const run = await repo.update("run-1", { branchName: "ai/run-1", prNumber: 7 });

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { branchName: "ai/run-1", prNumber: 7 },
    });
    expect(run.branchName).toBe("ai/run-1");
    expect(run.prNumber).toBe(7);
  });
});
