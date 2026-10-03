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

function buildPrisma() {
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
    it("creates a run with Todo state and maps optional fields to null when omitted", async () => {
      const prisma = buildPrisma();
      const row = makeRow({ linearIssueIdentifier: null, linearIssueDescription: null, linearIssueTitle: null, linearIssueUrl: null });
      prisma.aiRun.create.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      const result = await repo.create({
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
      expect(result.id).toBe("run-1");
      expect(result.state).toBe(RunState.Todo);
    });

    it("passes through optional fields when provided", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.create.mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma as never);

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

  describe("findAll", () => {
    it("queries without a where clause when no stateFilter is given", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("builds an equality where clause for a single state", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Todo");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an `in` where clause for multiple comma-separated states, trimming whitespace", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Todo, Planning , Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an all-empty/whitespace stateFilter as no filter", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll(" , ,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-42" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("run-42");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
      expect(result?.id).toBe("run-42");
    });

    it("returns null when not found", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the latest-created run for the issue", async () => {
      const prisma = buildPrisma();
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
      const prisma = buildPrisma();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("LIN-404");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Planning" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Planning);
    });

    it("returns null when no active run exists", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped domain object", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "AIReview" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.updateState("run-1", RunState.AIReview);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "AIReview" },
      });
      expect(result.state).toBe(RunState.AIReview);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing title or description via OR", async () => {
      const prisma = buildPrisma();
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

    it("returns an empty array when no runs need backfill", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the given partial data straight through to prisma", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/run-1", prNumber: 5 }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.update("run-1", { branchName: "ai/run-1", prNumber: 5 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/run-1", prNumber: 5 },
      });
      expect(result.branchName).toBe("ai/run-1");
      expect(result.prNumber).toBe(5);
    });
  });
});
