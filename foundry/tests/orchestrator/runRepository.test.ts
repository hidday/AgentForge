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
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
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
  it("create() defaults optional Linear fields to null and sets state to Todo", async () => {
    const prisma = makePrisma();
    prisma.aiRun.create.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma as never);

    await repo.create({
      linearIssueId: "LIN-1",
      repo: "test-repo",
      workingDirectory: "/tmp",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
        state: "Todo",
      }),
    });
  });

  describe("findAll", () => {
    it("queries with no filter when stateFilter is omitted", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by a single state", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Todo");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple comma-separated states using an `in` clause", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Todo, Planning ,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty/whitespace-only filter the same as no filter", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("  ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  it("findById returns null when no row matches", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findUnique.mockResolvedValue(null);
    const repo = new RunRepository(prisma as never);

    const result = await repo.findById("missing");

    expect(result).toBeNull();
  });

  it("findById maps the found row's state to the RunState domain type", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findUnique.mockResolvedValue(makeRow({ state: "Planning" }));
    const repo = new RunRepository(prisma as never);

    const result = await repo.findById("run-1");

    expect(result?.state).toBe(RunState.Planning);
  });

  it("findByIssueId returns the most recent run for an issue, or null", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma as never);

    await repo.findByIssueId("LIN-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findActiveByIssueId excludes terminal states (Done, Failed)", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findFirst.mockResolvedValue(null);
    const repo = new RunRepository(prisma as never);

    await repo.findActiveByIssueId("LIN-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "LIN-1",
        state: { notIn: [RunState.Done, RunState.Failed] },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("updateState persists the new state and maps the result back", async () => {
    const prisma = makePrisma();
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Done" }));
    const repo = new RunRepository(prisma as never);

    const result = await repo.updateState("run-1", RunState.Done);

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: RunState.Done },
    });
    expect(result.state).toBe(RunState.Done);
  });

  it("findRunsNeedingLinearBackfill queries runs missing title or description", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);
    const repo = new RunRepository(prisma as never);

    const result = await repo.findRunsNeedingLinearBackfill();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(result).toHaveLength(1);
  });

  it("update() passes through partial fields and maps the result", async () => {
    const prisma = makePrisma();
    prisma.aiRun.update.mockResolvedValue(makeRow({ prNumber: 42 }));
    const repo = new RunRepository(prisma as never);

    const result = await repo.update("run-1", { prNumber: 42 });

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { prNumber: 42 },
    });
    expect(result.prNumber).toBe(42);
  });
});
