import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    aiRun: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run with all optional fields provided and maps the result", async () => {
      const row = makeRow();
      const prisma = makePrisma({ create: vi.fn().mockResolvedValue(row) });
      const repo = new RunRepository(prisma);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue/ENG-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue/ENG-1",
          repo: "test-repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("defaults missing optional fields to null", async () => {
      const row = makeRow();
      const prisma = makePrisma({ create: vi.fn().mockResolvedValue(row) });
      const repo = new RunRepository(prisma);

      await repo.create({
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
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when stateFilter is omitted", async () => {
      const rows = [makeRow(), makeRow({ id: "run-2" })];
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue(rows) });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("queries with a single state when stateFilter has one value", async () => {
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("queries with an 'in' filter when stateFilter has multiple comma-separated values", async () => {
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning, PlanReview,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "PlanReview", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty/whitespace-only stateFilter as no filter", async () => {
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new RunRepository(prisma);

      await repo.findAll(" , ,  ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every row to the domain shape", async () => {
      const rows = [makeRow({ id: "a", state: "Done" }), makeRow({ id: "b", state: "Failed" })];
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue(rows) });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(result.map((r) => r.state)).toEqual([RunState.Done, RunState.Failed]);
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const row = makeRow({ id: "run-42" });
      const prisma = makePrisma({ findUnique: vi.fn().mockResolvedValue(row) });
      const repo = new RunRepository(prisma);

      const result = await repo.findById("run-42");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("returns null when not found", async () => {
      const prisma = makePrisma({ findUnique: vi.fn().mockResolvedValue(null) });
      const repo = new RunRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the mapped run when found, ordered by most recent", async () => {
      const row = makeRow({ linearIssueId: "LIN-99" });
      const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(row) });
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-99");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-99" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-99");
    });

    it("returns null when no run matches the issue id", async () => {
      const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-missing");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const row = makeRow({ state: "Planning" });
      const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(row) });
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

    it("returns null when no active run exists for the issue", async () => {
      const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
      const repo = new RunRepository(prisma);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state field and returns the mapped run", async () => {
      const row = makeRow({ state: "Done" });
      const prisma = makePrisma({ update: vi.fn().mockResolvedValue(row) });
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
    it("queries for runs missing title or description and maps results", async () => {
      const rows = [makeRow({ linearIssueTitle: null }), makeRow({ linearIssueDescription: null })];
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue(rows) });
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
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes partial data through to prisma and maps the result", async () => {
      const row = makeRow({ branchName: "ai/run-1", prNumber: 7 });
      const prisma = makePrisma({ update: vi.fn().mockResolvedValue(row) });
      const repo = new RunRepository(prisma);

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
