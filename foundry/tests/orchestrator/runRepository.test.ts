import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
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
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildRepo() {
  const prisma = {
    aiRun: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  const repo = new RunRepository(prisma as never);
  return { repo, prisma };
}

describe("RunRepository.create", () => {
  it("creates a run with state Todo and nulls defaulted for omitted optional fields", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.create.mockResolvedValue(makeRow({ linearIssueIdentifier: null }));

    const run = await repo.create({
      linearIssueId: "LIN-1",
      repo: "test-repo",
      workingDirectory: "/tmp",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: {
        linearIssueId: "LIN-1",
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
        repo: "test-repo",
        workingDirectory: "/tmp",
        state: "Todo",
      },
    });
    expect(run.state).toBe(RunState.Todo);
    expect(run.id).toBe("run-1");
  });

  it("passes through optional fields when provided", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.create.mockResolvedValue(makeRow());

    await repo.create({
      linearIssueId: "LIN-1",
      linearIssueIdentifier: "ENG-1",
      linearIssueDescription: "desc",
      linearIssueTitle: "title",
      linearIssueUrl: "https://linear.app/x",
      repo: "test-repo",
      workingDirectory: "/tmp",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
      }),
    });
  });
});

describe("RunRepository.findAll", () => {
  it("queries without a where clause when no filter is given", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findMany.mockResolvedValue([makeRow()]);

    const runs = await repo.findAll();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].state).toBe(RunState.Todo);
  });

  it("queries with a single-state where clause", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findMany.mockResolvedValue([]);

    await repo.findAll("Planning");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: "Planning" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("queries with an 'in' where clause for multiple comma-separated states", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findMany.mockResolvedValue([]);

    await repo.findAll("Planning, PlanReview ,Implementing");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Planning", "PlanReview", "Implementing"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("falls back to no where clause when the filter is only commas/whitespace", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findMany.mockResolvedValue([]);

    await repo.findAll(" , , ");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("RunRepository.findById", () => {
  it("returns the mapped run when found", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-2" }));

    const run = await repo.findById("run-2");

    expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-2" } });
    expect(run?.id).toBe("run-2");
  });

  it("returns null when not found", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findUnique.mockResolvedValue(null);

    const run = await repo.findById("missing");

    expect(run).toBeNull();
  });
});

describe("RunRepository.findByIssueId", () => {
  it("returns the mapped run when found", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow());

    const run = await repo.findByIssueId("LIN-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(run?.linearIssueId).toBe("LIN-1");
  });

  it("returns null when not found", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findFirst.mockResolvedValue(null);

    expect(await repo.findByIssueId("missing")).toBeNull();
  });
});

describe("RunRepository.findActiveByIssueId", () => {
  it("excludes terminal states (Done, Failed) from the query", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow());

    await repo.findActiveByIssueId("LIN-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "LIN-1",
        state: { notIn: ["Done", "Failed"] },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns null when there is no active run", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findFirst.mockResolvedValue(null);

    expect(await repo.findActiveByIssueId("LIN-1")).toBeNull();
  });
});

describe("RunRepository.updateState", () => {
  it("updates the state field and returns the mapped run", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "PlanReview" }));

    const run = await repo.updateState("run-1", RunState.PlanReview);

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: "PlanReview" },
    });
    expect(run.state).toBe(RunState.PlanReview);
  });
});

describe("RunRepository.findRunsNeedingLinearBackfill", () => {
  it("queries for runs missing title or description and maps the rows", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);

    const runs = await repo.findRunsNeedingLinearBackfill();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(runs).toHaveLength(1);
  });
});

describe("RunRepository.update", () => {
  it("passes partial data straight through to prisma and maps the result", async () => {
    const { repo, prisma } = buildRepo();
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
