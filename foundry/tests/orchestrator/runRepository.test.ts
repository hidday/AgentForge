import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

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

const baseRow = {
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
};

describe("RunRepository", () => {
  describe("create()", () => {
    it("creates a run in the Todo state with optional linear fields defaulted to null", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.create.mockResolvedValue(baseRow);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

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

    it("creates a run passing through all optional linear fields when provided", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.create.mockResolvedValue({
        ...baseRow,
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/LIN-1",
      });
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/LIN-1",
          repo: "test-repo",
          workingDirectory: "/tmp",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll()", () => {
    it("queries without a where clause when no stateFilter is given", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([baseRow]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });

    it("filters by a single state when stateFilter has one value", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple states (comma-separated, trimmed) using an `in` clause", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.findAll("Planning, Implementing ,AIReview");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "Implementing", "AIReview"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty/whitespace-only stateFilter as no filter", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.findAll("  ,  ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById()", () => {
    it("returns the mapped run when found", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findUnique.mockResolvedValue(baseRow);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId()", () => {
    it("returns the most recent run for the issue when found", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findFirst.mockResolvedValue(baseRow);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run exists for the issue", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByIssueId("LIN-999");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId()", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findFirst.mockResolvedValue(baseRow);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when there is no active run for the issue", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState()", () => {
    it("updates the run's state and returns the mapped run", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.update.mockResolvedValue({ ...baseRow, state: "Planning" });
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.updateState("run-1", RunState.Planning);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Planning" },
      });
      expect(result.state).toBe(RunState.Planning);
    });
  });

  describe("findRunsNeedingLinearBackfill()", () => {
    it("queries runs with a null title or description", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([baseRow]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when no runs need backfilling", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update()", () => {
    it("passes the partial data straight through to prisma and returns the mapped run", async () => {
      const prisma = buildPrisma();
      prisma.aiRun.update.mockResolvedValue({ ...baseRow, branchName: "ai/lin-1", prNumber: 42 });
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.update("run-1", { branchName: "ai/lin-1", prNumber: 42 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/lin-1", prNumber: 42 },
      });
      expect(result.branchName).toBe("ai/lin-1");
      expect(result.prNumber).toBe(42);
    });
  });
});
