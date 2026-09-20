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
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrismaMock() {
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
    it("creates a row with state Todo and passes through all provided fields", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test-repo",
        workingDirectory: "/tmp/wd",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
          repo: "test-repo",
          workingDirectory: "/tmp/wd",
          state: "Todo",
        },
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("defaults optional Linear metadata fields to null when omitted", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.create.mockResolvedValue(
        makeRow({
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
        }),
      );
      const repo = new RunRepository(prisma as never);

      await repo.create({
        linearIssueId: "LIN-2",
        repo: "test-repo",
        workingDirectory: "/tmp/wd2",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-2",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "test-repo",
          workingDirectory: "/tmp/wd2",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries without a where filter when no stateFilter is given", async () => {
      const prisma = makePrismaMock();
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

    it("filters by a single state when one state is given", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple states using an 'in' clause, trimming whitespace", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Planning, AIReview ,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "AIReview", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats a stateFilter that is only whitespace/commas as no filter (boundary: zero states after filtering)", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll(" , , ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns an empty array when nothing matches", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findAll();
      expect(result).toEqual([]);
    });
  });

  describe("findById", () => {
    it("returns the mapped domain Run when found", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-42" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("run-42");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
      expect(result?.id).toBe("run-42");
      expect(result?.state).toBe(RunState.Todo);
    });

    it("returns null when not found", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the most recent run for the issue when found", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ linearIssueId: "LIN-9" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("LIN-9");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-9" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-9");
    });

    it("returns null when no run exists for the issue", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("LIN-missing");
      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const prisma = makePrismaMock();
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

    it("returns null when the only runs for the issue are terminal (none active)", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("LIN-1");
      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the row's state and returns the mapped domain Run", async () => {
      const prisma = makePrismaMock();
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
    it("queries for runs missing title or description and maps them to domain Runs", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([
        makeRow({ id: "run-a", linearIssueTitle: null }),
        makeRow({ id: "run-b", linearIssueDescription: null }),
      ]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result.map((r) => r.id)).toEqual(["run-a", "run-b"]);
    });

    it("returns an empty array when no runs need backfill", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();
      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes through partial field updates and returns the mapped domain Run", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.update.mockResolvedValue(
        makeRow({ prNumber: 7, branchName: "ai/run-1" }),
      );
      const repo = new RunRepository(prisma as never);

      const result = await repo.update("run-1", { prNumber: 7, branchName: "ai/run-1" });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { prNumber: 7, branchName: "ai/run-1" },
      });
      expect(result.prNumber).toBe(7);
      expect(result.branchName).toBe("ai/run-1");
    });

    it("supports updating a single field (e.g. approvedPlanVersion) without affecting others", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.update.mockResolvedValue(makeRow({ approvedPlanVersion: 3 }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.update("run-1", { approvedPlanVersion: 3 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { approvedPlanVersion: 3 },
      });
      expect(result.approvedPlanVersion).toBe(3);
    });
  });
});
