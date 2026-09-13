import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

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

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
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
    workingDirectory: "/workspace/run-1",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run with all optional fields provided", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "org/repo",
        workingDirectory: "/workspace/run-1",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
          repo: "org/repo",
          workingDirectory: "/workspace/run-1",
          state: "Todo",
        },
      });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("defaults missing optional fields to null", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
      prisma.aiRun.create.mockResolvedValue(row);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.create({
        linearIssueId: "LIN-2",
        repo: "org/repo2",
        workingDirectory: "/workspace/run-2",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-2",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "org/repo2",
          workingDirectory: "/workspace/run-2",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when stateFilter is omitted", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("queries with a single state when stateFilter has one value", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({ state: "Done" });
      prisma.aiRun.findMany.mockResolvedValue([row]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findAll("Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Done" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual([{ ...row, state: RunState.Done }]);
    });

    it("queries with an `in` filter when stateFilter has multiple comma-separated values, trimming whitespace and dropping empties", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.findAll("Todo, Planning ,,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("leaves where undefined when stateFilter reduces to zero valid states", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.findAll(" , ,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row to the domain shape", async () => {
      const prisma = makePrismaMock();
      const rows = [makeRow({ id: "r1", state: "Todo" }), makeRow({ id: "r2", state: "Failed" })];
      prisma.aiRun.findMany.mockResolvedValue(rows);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findAll();

      expect(result).toEqual([
        { ...rows[0], state: RunState.Todo },
        { ...rows[1], state: RunState.Failed },
      ]);
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      prisma.aiRun.findUnique.mockResolvedValue(row);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("returns null when not found", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the mapped run when found, ordered by most recent", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      prisma.aiRun.findFirst.mockResolvedValue(row);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("returns null when no run matches the issue id", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByIssueId("LIN-none");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("queries excluding terminal states and returns the mapped run", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({ state: "Implementing" });
      prisma.aiRun.findFirst.mockResolvedValue(row);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: [RunState.Done, RunState.Failed] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual({ ...row, state: RunState.Implementing });
    });

    it("returns null when there is no active run for the issue", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped result", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({ state: "AIReview" });
      prisma.aiRun.update.mockResolvedValue(row);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.updateState("run-1", RunState.AIReview);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: RunState.AIReview },
      });
      expect(result).toEqual({ ...row, state: RunState.AIReview });
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries for runs missing title or description and maps results", async () => {
      const prisma = makePrismaMock();
      const rows = [makeRow({ id: "r1", linearIssueTitle: null })];
      prisma.aiRun.findMany.mockResolvedValue(rows);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toEqual([{ ...rows[0], state: RunState.Todo }]);
    });

    it("returns an empty array when no runs need backfill", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data straight through and returns the mapped result", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({ branchName: "feature/x", prNumber: 42 });
      prisma.aiRun.update.mockResolvedValue(row);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 42 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feature/x", prNumber: 42 },
      });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });
  });
});
