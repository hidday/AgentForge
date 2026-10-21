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
  } as unknown as PrismaClient;
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run with Todo state and maps optional fields to null when omitted", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new RunRepository(prisma);

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
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("passes through optional Linear metadata when provided", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-42",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue/ENG-42",
        repo: "test-repo",
        workingDirectory: "/tmp",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "ENG-42",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue/ENG-42",
        }),
      });
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no stateFilter is given", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("filters by a single state when stateFilter has one value", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple states when stateFilter is comma-separated, trimming whitespace", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning, PlanReview , Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "PlanReview", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty/blank stateFilter string as no filter", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      await repo.findAll("  ,  ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow({ id: "run-2" }));
      const repo = new RunRepository(prisma);

      const result = await repo.findById("run-2");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-2" } });
      expect(result?.id).toBe("run-2");
    });

    it("returns null when not found", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new RunRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the most recent run for the issue", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run exists for the issue", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new RunRepository(prisma);

      expect(await repo.findByIssueId("LIN-missing")).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow({ state: "Planning" }));
      const repo = new RunRepository(prisma);

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

    it("returns null when the only runs are terminal", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new RunRepository(prisma);

      expect(await repo.findActiveByIssueId("LIN-1")).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped domain object", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow({ state: "Done" }));
      const repo = new RunRepository(prisma);

      const result = await repo.updateState("run-1", RunState.Done);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Done" },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing a title OR a description", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ linearIssueTitle: null }),
        makeRow({ linearIssueDescription: null }),
      ]);
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(2);
    });

    it("returns an empty array when nothing needs backfill", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      expect(await repo.findRunsNeedingLinearBackfill()).toEqual([]);
    });
  });

  describe("update", () => {
    it("forwards the partial update payload and returns the mapped run", async () => {
      const prisma = makePrisma();
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ branchName: "ai/lin-1", prNumber: 7 }),
      );
      const repo = new RunRepository(prisma);

      const result = await repo.update("run-1", { branchName: "ai/lin-1", prNumber: 7 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/lin-1", prNumber: 7 },
      });
      expect(result.branchName).toBe("ai/lin-1");
      expect(result.prNumber).toBe(7);
    });
  });
});
