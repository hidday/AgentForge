import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrismaMock() {
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

describe("RunRepository.create", () => {
  it("creates a run with state Todo and maps nullish optional fields to null", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.create.mockResolvedValue(
      makeRow({ linearIssueIdentifier: null, linearIssueDescription: null }),
    );
    const repo = new RunRepository(prisma as never);

    const run = await repo.create({
      linearIssueId: "LIN-1",
      repo: "test-repo",
      workingDirectory: "/tmp",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp",
        state: "Todo",
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      }),
    });
    expect(run.state).toBe(RunState.Todo);
  });

  it("passes through optional fields when provided", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.create.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma as never);

    await repo.create({
      linearIssueId: "LIN-1",
      linearIssueIdentifier: "LIN-1",
      linearIssueDescription: "desc",
      linearIssueTitle: "title",
      linearIssueUrl: "https://linear.app/x",
      repo: "test-repo",
      workingDirectory: "/tmp",
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
});

describe("RunRepository.findAll", () => {
  it("queries with no where clause when stateFilter is omitted", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
    const repo = new RunRepository(prisma as never);

    const runs = await repo.findAll();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].state).toBe(RunState.Todo);
  });

  it("builds a single-state where clause for a single filter value", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma as never);

    await repo.findAll("Planning");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: "Planning" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("builds an `in` where clause for multiple comma-separated states, trimming whitespace", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma as never);

    await repo.findAll("Planning, PlanReview , Done");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Planning", "PlanReview", "Done"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("treats an empty/whitespace-only filter as no filter", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma as never);

    await repo.findAll("  ,  ");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  it("maps multiple rows to domain Run objects", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findMany.mockResolvedValue([
      makeRow({ id: "r1", state: "Todo" }),
      makeRow({ id: "r2", state: "Done" }),
    ]);
    const repo = new RunRepository(prisma as never);

    const runs = await repo.findAll();
    expect(runs.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(runs.map((r) => r.state)).toEqual([RunState.Todo, RunState.Done]);
  });
});

describe("RunRepository.findById", () => {
  it("returns the mapped run when found", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-42" }));
    const repo = new RunRepository(prisma as never);

    const run = await repo.findById("run-42");

    expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
    expect(run?.id).toBe("run-42");
  });

  it("returns null when not found", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findUnique.mockResolvedValue(null);
    const repo = new RunRepository(prisma as never);

    const run = await repo.findById("missing");
    expect(run).toBeNull();
  });
});

describe("RunRepository.findByIssueId", () => {
  it("returns the most recent run for the issue (no state filter)", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow({ linearIssueId: "LIN-7" }));
    const repo = new RunRepository(prisma as never);

    const run = await repo.findByIssueId("LIN-7");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-7" },
      orderBy: { createdAt: "desc" },
    });
    expect(run?.linearIssueId).toBe("LIN-7");
  });

  it("returns null when no run exists for the issue", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findFirst.mockResolvedValue(null);
    const repo = new RunRepository(prisma as never);

    expect(await repo.findByIssueId("none")).toBeNull();
  });
});

describe("RunRepository.findActiveByIssueId", () => {
  it("excludes terminal states (Done, Failed) from the query", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Planning" }));
    const repo = new RunRepository(prisma as never);

    const run = await repo.findActiveByIssueId("LIN-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "LIN-1",
        state: { notIn: ["Done", "Failed"] },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(run?.state).toBe(RunState.Planning);
  });

  it("returns null when every run for the issue is terminal", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findFirst.mockResolvedValue(null);
    const repo = new RunRepository(prisma as never);

    expect(await repo.findActiveByIssueId("LIN-1")).toBeNull();
  });
});

describe("RunRepository.updateState", () => {
  it("updates the run's state and returns the mapped domain object", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Done" }));
    const repo = new RunRepository(prisma as never);

    const run = await repo.updateState("run-1", RunState.Done);

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: "Done" },
    });
    expect(run.state).toBe(RunState.Done);
  });
});

describe("RunRepository.findRunsNeedingLinearBackfill", () => {
  it("queries runs missing title or description via OR", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findMany.mockResolvedValue([
      makeRow({ id: "r1", linearIssueTitle: null }),
      makeRow({ id: "r2", linearIssueDescription: null }),
    ]);
    const repo = new RunRepository(prisma as never);

    const runs = await repo.findRunsNeedingLinearBackfill();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(runs).toHaveLength(2);
  });

  it("returns an empty array when nothing needs backfill", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma as never);

    expect(await repo.findRunsNeedingLinearBackfill()).toEqual([]);
  });
});

describe("RunRepository.update", () => {
  it("passes partial data through to prisma and maps the result", async () => {
    const prisma = buildPrismaMock();
    prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/run-1", prNumber: 5 }));
    const repo = new RunRepository(prisma as never);

    const run = await repo.update("run-1", { branchName: "ai/run-1", prNumber: 5 });

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { branchName: "ai/run-1", prNumber: 5 },
    });
    expect(run.branchName).toBe("ai/run-1");
    expect(run.prNumber).toBe(5);
  });
});
