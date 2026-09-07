import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

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
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
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
  it("creates a run with Todo state and maps optional fields to null when omitted", async () => {
    const create = vi.fn().mockResolvedValue(makeRow());
    const prisma = makePrisma({ create });
    const repo = new RunRepository(prisma);

    const run = await repo.create({
      linearIssueId: "LIN-1",
      repo: "test-repo",
      workingDirectory: "/tmp",
    });

    expect(create).toHaveBeenCalledWith({
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

  it("passes through provided optional linear fields", async () => {
    const create = vi.fn().mockResolvedValue(makeRow({ linearIssueIdentifier: "ENG-1" }));
    const prisma = makePrisma({ create });
    const repo = new RunRepository(prisma);

    await repo.create({
      linearIssueId: "LIN-1",
      linearIssueIdentifier: "ENG-1",
      linearIssueTitle: "Title",
      repo: "test-repo",
      workingDirectory: "/tmp",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueIdentifier: "ENG-1",
        linearIssueTitle: "Title",
      }),
    });
  });
});

describe("RunRepository.findAll", () => {
  it("queries without a where clause when no stateFilter is given", async () => {
    const findMany = vi.fn().mockResolvedValue([makeRow()]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    const runs = await repo.findAll();

    expect(findMany).toHaveBeenCalledWith({ where: undefined, orderBy: { createdAt: "desc" } });
    expect(runs).toHaveLength(1);
    expect(runs[0].state).toBe(RunState.Todo);
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

  it("treats an empty/whitespace-only stateFilter as no filter", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    await repo.findAll("  ,  ");

    expect(findMany).toHaveBeenCalledWith({ where: undefined, orderBy: { createdAt: "desc" } });
  });
});

describe("RunRepository.findById", () => {
  it("returns the mapped run when found", async () => {
    const findUnique = vi.fn().mockResolvedValue(makeRow());
    const prisma = makePrisma({ findUnique });
    const repo = new RunRepository(prisma);

    const run = await repo.findById("run-1");

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
    expect(run?.id).toBe("run-1");
  });

  it("returns null when not found", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findUnique });
    const repo = new RunRepository(prisma);

    const run = await repo.findById("missing");

    expect(run).toBeNull();
  });
});

describe("RunRepository.findByIssueId", () => {
  it("returns the most recent run for the issue", async () => {
    const findFirst = vi.fn().mockResolvedValue(makeRow());
    const prisma = makePrisma({ findFirst });
    const repo = new RunRepository(prisma);

    const run = await repo.findByIssueId("LIN-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(run?.linearIssueId).toBe("LIN-1");
  });

  it("returns null when no run exists for the issue", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new RunRepository(prisma);

    expect(await repo.findByIssueId("LIN-404")).toBeNull();
  });
});

describe("RunRepository.findActiveByIssueId", () => {
  it("excludes terminal states from the query", async () => {
    const findFirst = vi.fn().mockResolvedValue(makeRow());
    const prisma = makePrisma({ findFirst });
    const repo = new RunRepository(prisma);

    await repo.findActiveByIssueId("LIN-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "LIN-1",
        state: { notIn: ["Done", "Failed"] },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns null when no active run exists", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new RunRepository(prisma);

    expect(await repo.findActiveByIssueId("LIN-1")).toBeNull();
  });
});

describe("RunRepository.updateState", () => {
  it("updates the state field and returns the mapped run", async () => {
    const update = vi.fn().mockResolvedValue(makeRow({ state: "Planning" }));
    const prisma = makePrisma({ update });
    const repo = new RunRepository(prisma);

    const run = await repo.updateState("run-1", RunState.Planning);

    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: "Planning" },
    });
    expect(run.state).toBe(RunState.Planning);
  });
});

describe("RunRepository.findRunsNeedingLinearBackfill", () => {
  it("queries runs missing title or description and maps them", async () => {
    const findMany = vi.fn().mockResolvedValue([makeRow({ linearIssueTitle: null })]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    const runs = await repo.findRunsNeedingLinearBackfill();

    expect(findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(runs).toHaveLength(1);
  });
});

describe("RunRepository.update", () => {
  it("updates the given fields and returns the mapped run", async () => {
    const update = vi.fn().mockResolvedValue(makeRow({ prNumber: 7 }));
    const prisma = makePrisma({ update });
    const repo = new RunRepository(prisma);

    const run = await repo.update("run-1", { prNumber: 7 });

    expect(update).toHaveBeenCalledWith({ where: { id: "run-1" }, data: { prNumber: 7 } });
    expect(run.prNumber).toBe(7);
  });
});
