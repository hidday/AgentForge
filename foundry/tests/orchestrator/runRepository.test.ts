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
    linearIssueUrl: "https://linear.app/issue/LIN-1",
    repo: "test-repo",
    branchName: "ai/run-1",
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
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    aiRun: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      ...overrides,
    },
  };
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run with defaults for optional fields and maps to domain", async () => {
      const row = makeRow({ linearIssueIdentifier: null, linearIssueDescription: null, linearIssueTitle: null, linearIssueUrl: null });
      const prisma = buildPrisma({ create: vi.fn().mockResolvedValue(row) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "test-repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
      expect(result.id).toBe("run-1");
      expect(result.state).toBe(RunState.Todo);
    });

    it("passes through optional fields when provided", async () => {
      const row = makeRow();
      const prisma = buildPrisma({ create: vi.fn().mockResolvedValue(row) });
      const repo = new RunRepository(prisma as never);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue/LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue/LIN-1",
        }),
      });
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no state filter is given", async () => {
      const prisma = buildPrisma({ findMany: vi.fn().mockResolvedValue([makeRow()]) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("filters by a single state", async () => {
      const prisma = buildPrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple comma-separated states, trimming whitespace", async () => {
      const prisma = buildPrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Planning, Todo ,  AIReview");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "Todo", "AIReview"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty-string filter (after trimming/filtering) as no filter", async () => {
      const prisma = buildPrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new RunRepository(prisma as never);

      await repo.findAll(" , ,  ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const prisma = buildPrisma({ findUnique: vi.fn().mockResolvedValue(makeRow()) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      const prisma = buildPrisma({ findUnique: vi.fn().mockResolvedValue(null) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the most recent run for the issue", async () => {
      const prisma = buildPrisma({ findFirst: vi.fn().mockResolvedValue(makeRow()) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run exists for the issue", async () => {
      const prisma = buildPrisma({ findFirst: vi.fn().mockResolvedValue(null) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("LIN-missing");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const prisma = buildPrisma({ findFirst: vi.fn().mockResolvedValue(makeRow()) });
      const repo = new RunRepository(prisma as never);

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
      const prisma = buildPrisma({ findFirst: vi.fn().mockResolvedValue(null) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run state and maps the result", async () => {
      const row = makeRow({ state: "Done" });
      const prisma = buildPrisma({ update: vi.fn().mockResolvedValue(row) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.updateState("run-1", RunState.Done);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Done" },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing title or description and maps them", async () => {
      const prisma = buildPrisma({ findMany: vi.fn().mockResolvedValue([makeRow()]) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when nothing needs backfill", async () => {
      const prisma = buildPrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes through the partial data and maps the returned row", async () => {
      const row = makeRow({ branchName: "ai/new-branch", prNumber: 7 });
      const prisma = buildPrisma({ update: vi.fn().mockResolvedValue(row) });
      const repo = new RunRepository(prisma as never);

      const result = await repo.update("run-1", { branchName: "ai/new-branch", prNumber: 7 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/new-branch", prNumber: 7 },
      });
      expect(result.branchName).toBe("ai/new-branch");
      expect(result.prNumber).toBe(7);
    });
  });
});
