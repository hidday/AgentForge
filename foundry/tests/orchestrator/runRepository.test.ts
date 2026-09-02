import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/issue/LIN-1",
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
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    aiRun: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe("RunRepository.create", () => {
  it("creates a run in the Todo state with all provided optional fields", async () => {
    const row = makeRow();
    const create = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ create });
    const repo = new RunRepository(prisma);

    const result = await repo.create({
      linearIssueId: "LIN-1",
      linearIssueIdentifier: "LIN-1",
      linearIssueDescription: "desc",
      linearIssueTitle: "title",
      linearIssueUrl: "https://linear.app/issue/LIN-1",
      repo: "org/repo",
      workingDirectory: "/tmp/work",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue/LIN-1",
        repo: "org/repo",
        workingDirectory: "/tmp/work",
        state: "Todo",
      },
    });
    expect(result.state).toBe(RunState.Todo);
    expect(result.id).toBe("run-1");
  });

  it("defaults omitted optional Linear fields to null", async () => {
    const row = makeRow({
      linearIssueIdentifier: null,
      linearIssueDescription: null,
      linearIssueTitle: null,
      linearIssueUrl: null,
    });
    const create = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ create });
    const repo = new RunRepository(prisma);

    await repo.create({
      linearIssueId: "LIN-2",
      repo: "org/repo",
      workingDirectory: "/tmp/work",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        linearIssueId: "LIN-2",
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
        repo: "org/repo",
        workingDirectory: "/tmp/work",
        state: "Todo",
      },
    });
  });
});

describe("RunRepository.findAll", () => {
  it("queries with no where clause when no state filter is given", async () => {
    const findMany = vi.fn().mockResolvedValue([makeRow()]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    await repo.findAll();

    expect(findMany).toHaveBeenCalledWith({ where: undefined, orderBy: { createdAt: "desc" } });
  });

  it("filters by a single state", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    await repo.findAll("Planning");

    expect(findMany).toHaveBeenCalledWith({
      where: { state: "Planning" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("filters by multiple comma-separated states, trimming whitespace", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    await repo.findAll("Planning, PlanReview ,Done");

    expect(findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Planning", "PlanReview", "Done"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("falls back to no where clause when the filter is only whitespace/commas", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    await repo.findAll("  , ,");

    expect(findMany).toHaveBeenCalledWith({ where: undefined, orderBy: { createdAt: "desc" } });
  });

  it("maps every returned row to the domain shape", async () => {
    const rows = [makeRow({ id: "r1", state: "Done" }), makeRow({ id: "r2", state: "Failed" })];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    const result = await repo.findAll();

    expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(result[0].state).toBe(RunState.Done);
    expect(result[1].state).toBe(RunState.Failed);
  });
});

describe("RunRepository.findById", () => {
  it("returns the mapped run when found", async () => {
    const row = makeRow();
    const findUnique = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ findUnique });
    const repo = new RunRepository(prisma);

    const result = await repo.findById("run-1");

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
    expect(result?.id).toBe("run-1");
  });

  it("returns null when not found", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findUnique });
    const repo = new RunRepository(prisma);

    const result = await repo.findById("missing");

    expect(result).toBeNull();
  });
});

describe("RunRepository.findByIssueId", () => {
  it("returns the most recent run for the issue when found", async () => {
    const row = makeRow();
    const findFirst = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ findFirst });
    const repo = new RunRepository(prisma);

    const result = await repo.findByIssueId("LIN-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result?.linearIssueId).toBe("LIN-1");
  });

  it("returns null when the issue has no runs", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new RunRepository(prisma);

    const result = await repo.findByIssueId("LIN-none");

    expect(result).toBeNull();
  });
});

describe("RunRepository.findActiveByIssueId", () => {
  it("excludes terminal states (Done, Failed) from the query", async () => {
    const row = makeRow({ state: "Implementing" });
    const findFirst = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ findFirst });
    const repo = new RunRepository(prisma);

    const result = await repo.findActiveByIssueId("LIN-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "LIN-1",
        state: { notIn: ["Done", "Failed"] },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(result?.state).toBe(RunState.Implementing);
  });

  it("returns null when there is no active run for the issue", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new RunRepository(prisma);

    const result = await repo.findActiveByIssueId("LIN-1");

    expect(result).toBeNull();
  });
});

describe("RunRepository.updateState", () => {
  it("updates the run's state and returns the mapped result", async () => {
    const row = makeRow({ state: "Planning" });
    const update = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ update });
    const repo = new RunRepository(prisma);

    const result = await repo.updateState("run-1", RunState.Planning);

    expect(update).toHaveBeenCalledWith({ where: { id: "run-1" }, data: { state: "Planning" } });
    expect(result.state).toBe(RunState.Planning);
  });
});

describe("RunRepository.findRunsNeedingLinearBackfill", () => {
  it("queries for runs missing a title or description", async () => {
    const rows = [makeRow({ id: "r1", linearIssueTitle: null })];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    const result = await repo.findRunsNeedingLinearBackfill();

    expect(findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("r1");
  });

  it("returns an empty array when no runs need backfilling", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    const result = await repo.findRunsNeedingLinearBackfill();

    expect(result).toEqual([]);
  });
});

describe("RunRepository.update", () => {
  it("passes the partial update data straight through and returns the mapped run", async () => {
    const row = makeRow({ branchName: "ai/lin-1", prNumber: 42 });
    const update = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ update });
    const repo = new RunRepository(prisma);

    const result = await repo.update("run-1", { branchName: "ai/lin-1", prNumber: 42 });

    expect(update).toHaveBeenCalledWith({ where: { id: "run-1" }, data: { branchName: "ai/lin-1", prNumber: 42 } });
    expect(result.branchName).toBe("ai/lin-1");
    expect(result.prNumber).toBe(42);
  });

  it("supports updating runtime and versioning fields", async () => {
    const row = makeRow({ plannerRuntime: "claude-code", planVersion: 3, approvedPlanVersion: 2 });
    const update = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ update });
    const repo = new RunRepository(prisma);

    await repo.update("run-1", { plannerRuntime: "claude-code", planVersion: 3, approvedPlanVersion: 2 });

    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { plannerRuntime: "claude-code", planVersion: 3, approvedPlanVersion: 2 },
    });
  });
});
