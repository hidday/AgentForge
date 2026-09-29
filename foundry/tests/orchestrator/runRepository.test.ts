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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
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
    it("creates a run with Todo state and maps nullish optional fields to null", async () => {
      const prisma = buildPrismaMock();
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);
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
      const prisma = buildPrismaMock();
      prisma.aiRun.create.mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma as never);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
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
      const prisma = buildPrismaMock();
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
      const prisma = buildPrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Todo");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an `in` where clause for multiple comma-separated states, trimming whitespace", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Todo, Planning ,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty/blank stateFilter as no filter", async () => {
      const prisma = buildPrismaMock();
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
    it("returns the most recent mapped run", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
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

    it("returns null when there is no active run", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state field and returns the mapped run", async () => {
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
    it("queries runs missing title or description and maps every row", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([
        makeRow({ id: "a", linearIssueTitle: null }),
        makeRow({ id: "b", linearIssueDescription: null }),
      ]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when nothing needs backfilling", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("forwards the partial data payload to prisma and returns the mapped run", async () => {
      const prisma = buildPrismaMock();
      prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/run-1", prNumber: 7 }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.update("run-1", { branchName: "ai/run-1", prNumber: 7 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/run-1", prNumber: 7 },
      });
      expect(result.branchName).toBe("ai/run-1");
      expect(result.prNumber).toBe(7);
    });
  });
});
