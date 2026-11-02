import { describe, it, expect, vi, beforeEach } from "vitest";
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
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
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
  let prisma: ReturnType<typeof makePrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new RunRepository(prisma as never);
  });

  it("creates a run with optional fields defaulted to null and state Todo", async () => {
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
  });

  it("passes through provided optional fields on create", async () => {
    prisma.aiRun.create.mockResolvedValue(makeRow({ linearIssueTitle: "Title" }));
    await repo.create({
      linearIssueId: "LIN-1",
      linearIssueIdentifier: "LIN-1",
      linearIssueDescription: "desc",
      linearIssueTitle: "Title",
      linearIssueUrl: "https://linear.app/x",
      repo: "test-repo",
      workingDirectory: "/tmp",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "Title",
        linearIssueUrl: "https://linear.app/x",
      }),
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no filter is given", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
      const runs = await repo.findAll();
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(runs).toHaveLength(1);
    });

    it("filters by a single state", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple comma-separated states, trimming whitespace", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo, Planning ,Done");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty filter string as no filter", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  it("findById returns the mapped run when found", async () => {
    prisma.aiRun.findUnique.mockResolvedValue(makeRow());
    const run = await repo.findById("run-1");
    expect(run).not.toBeNull();
    expect(run?.id).toBe("run-1");
  });

  it("findById returns null when not found", async () => {
    prisma.aiRun.findUnique.mockResolvedValue(null);
    const run = await repo.findById("missing");
    expect(run).toBeNull();
  });

  it("findByIssueId returns null when there is no match", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(null);
    expect(await repo.findByIssueId("LIN-9")).toBeNull();
    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-9" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findByIssueId returns the mapped run when found", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(makeRow({ id: "run-9" }));
    const run = await repo.findByIssueId("LIN-9");
    expect(run?.id).toBe("run-9");
  });

  it("findActiveByIssueId excludes terminal states", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));
    const run = await repo.findActiveByIssueId("LIN-1");
    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-1", state: { notIn: ["Done", "Failed"] } },
      orderBy: { createdAt: "desc" },
    });
    expect(run?.state).toBe(RunState.Implementing);
  });

  it("findActiveByIssueId returns null when there is no active run", async () => {
    prisma.aiRun.findFirst.mockResolvedValue(null);
    expect(await repo.findActiveByIssueId("LIN-1")).toBeNull();
  });

  it("updateState maps the resulting row to a domain Run", async () => {
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Planning" }));
    const run = await repo.updateState("run-1", RunState.Planning);
    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: "Planning" },
    });
    expect(run.state).toBe(RunState.Planning);
  });

  it("findRunsNeedingLinearBackfill queries runs missing title or description", async () => {
    prisma.aiRun.findMany.mockResolvedValue([makeRow(), makeRow({ id: "run-2" })]);
    const runs = await repo.findRunsNeedingLinearBackfill();
    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(runs).toHaveLength(2);
  });

  it("update patches the given fields and maps the result", async () => {
    prisma.aiRun.update.mockResolvedValue(makeRow({ prNumber: 42 }));
    const run = await repo.update("run-1", { prNumber: 42 });
    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { prNumber: 42 },
    });
    expect(run.prNumber).toBe(42);
  });
});
