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

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run with defaults for optional fields and maps state to domain", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.create.mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma as never);

      const result = await repo.create({
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
          repo: "test-repo",
          workingDirectory: "/tmp",
          state: "Todo",
        }),
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("passes through optional identifier/description/title/url when provided", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.create.mockResolvedValue(makeRow({ linearIssueIdentifier: "LIN-1" }));
      const repo = new RunRepository(prisma as never);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue/LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp",
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
    it("queries without a where clause when no stateFilter given", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });

    it("builds an equality where clause for a single state", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an `in` where clause for a comma-separated multi-state filter, trimming whitespace", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Planning, PlanReview ,Implementing");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "PlanReview", "Implementing"] } },
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
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-42" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("run-42");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
      expect(result?.id).toBe("run-42");
    });

    it("returns null when not found", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the most recent mapped run for the issue", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).not.toBeNull();
    });

    it("returns null when no run exists for the issue", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("LIN-404");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when there is no active run", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state field and maps the result", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Done" }));
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
    it("queries for runs missing title or description", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);
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
      const prisma = buildPrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes partial data through to prisma and maps the result", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.update.mockResolvedValue(makeRow({ prNumber: 7 }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.update("run-1", { prNumber: 7 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { prNumber: 7 },
      });
      expect(result.prNumber).toBe(7);
    });
  });
});
