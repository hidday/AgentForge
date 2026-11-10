import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeMockPrisma() {
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

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
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
    workingDirectory: "/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run with Todo state and nulls optional fields that are omitted", async () => {
      const mockPrisma = makeMockPrisma();
      const row = makeRow();
      mockPrisma.aiRun.create.mockResolvedValue(row);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "org/repo",
        workingDirectory: "/work",
      });

      expect(mockPrisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "org/repo",
          workingDirectory: "/work",
          state: "Todo",
        },
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("passes through optional fields when provided", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.create.mockResolvedValue(makeRow());

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "org/repo",
        workingDirectory: "/work",
      });

      expect(mockPrisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
          repo: "org/repo",
          workingDirectory: "/work",
          state: "Todo",
        },
      });
    });

    it("propagates errors from the underlying prisma call", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.create.mockRejectedValue(new Error("insert failed"));

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      await expect(
        repo.create({ linearIssueId: "LIN-1", repo: "org/repo", workingDirectory: "/work" }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no stateFilter is given", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findMany.mockResolvedValue([makeRow()]);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findAll();

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.state).toBe(RunState.Todo);
    });

    it("builds an equality where clause for a single state", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findMany.mockResolvedValue([]);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      await repo.findAll("Planning");

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an `in` where clause for multiple comma-separated states, trimming whitespace", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findMany.mockResolvedValue([]);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      await repo.findAll("Planning, Implementing , Done");

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "Implementing", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty-string stateFilter as no filter (falsy branch)", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findMany.mockResolvedValue([]);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      await repo.findAll("");

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("drops empty segments produced by stray commas, falling back to no filter when all are blank", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findMany.mockResolvedValue([]);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      await repo.findAll(" , ,");

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row to a domain Run", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findMany.mockResolvedValue([
        makeRow({ id: "a", state: "Todo" }),
        makeRow({ id: "b", state: "Done" }),
      ]);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
      expect(result.map((r) => r.state)).toEqual([RunState.Todo, RunState.Done]);
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-42" }));

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findById("run-42");

      expect(mockPrisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
      expect(result?.id).toBe("run-42");
    });

    it("returns null when not found", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findUnique.mockResolvedValue(null);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered descending by createdAt", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findFirst.mockResolvedValue(makeRow({ linearIssueId: "LIN-99" }));

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findByIssueId("LIN-99");

      expect(mockPrisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-99" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-99");
    });

    it("returns null when no run exists for the issue", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findFirst.mockResolvedValue(null);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findByIssueId("LIN-none");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findActiveByIssueId("LIN-1");

      expect(mockPrisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when no active run exists", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findFirst.mockResolvedValue(null);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped domain run", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.update.mockResolvedValue(makeRow({ state: "AIReview" }));

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.updateState("run-1", RunState.AIReview);

      expect(mockPrisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "AIReview" },
      });
      expect(result.state).toBe(RunState.AIReview);
    });

    it("propagates errors from the underlying prisma call", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.update.mockRejectedValue(new Error("not found"));

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      await expect(repo.updateState("missing", RunState.Done)).rejects.toThrow("not found");
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries with an OR filter on missing title or description and maps all rows", async () => {
      const mockPrisma = makeMockPrisma();
      const rows = [
        makeRow({ id: "a", linearIssueTitle: null }),
        makeRow({ id: "b", linearIssueDescription: null }),
      ];
      mockPrisma.aiRun.findMany.mockResolvedValue(rows);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findRunsNeedingLinearBackfill();

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when nothing needs backfilling", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.findMany.mockResolvedValue([]);

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data through to prisma and returns the mapped run", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.update.mockResolvedValue(
        makeRow({ branchName: "feature/x", prNumber: 7 }),
      );

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 7 });

      expect(mockPrisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feature/x", prNumber: 7 },
      });
      expect(result.branchName).toBe("feature/x");
      expect(result.prNumber).toBe(7);
    });

    it("propagates errors from the underlying prisma call", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.aiRun.update.mockRejectedValue(new Error("update failed"));

      const repo = new RunRepository(mockPrisma as unknown as PrismaClient);
      await expect(repo.update("run-1", { planVersion: 2 })).rejects.toThrow("update failed");
    });
  });
});
