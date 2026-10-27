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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
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
    it("creates a run with state Todo, defaulting optional Linear fields to null, and maps the row", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new RunRepository(prisma);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(create).toHaveBeenCalledWith({
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
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("passes through optional Linear fields when provided", async () => {
      const row = makeRow({
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
      });
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new RunRepository(prisma);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
          repo: "test-repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries with no state filter and orders by createdAt desc when stateFilter is omitted", async () => {
      const findMany = vi.fn().mockResolvedValue([makeRow()]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });

    it("builds a single-state where clause for a single state filter", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an `in` where clause for a comma-separated multi-state filter, trimming whitespace", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning, PlanReview , Done");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "PlanReview", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats a filter of only commas/whitespace as no filter (empty states list)", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findAll(" , , ");

      expect(findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row to the domain Run", async () => {
      const rows = [makeRow({ id: "r1", state: "Done" }), makeRow({ id: "r2", state: "Failed" })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
      expect(result.map((r) => r.state)).toEqual([RunState.Done, RunState.Failed]);
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const row = makeRow();
      const findUnique = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ findUnique });
      const repo = new RunRepository(prisma);

      const result = await repo.findById("run-1");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findUnique });
      const repo = new RunRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by createdAt desc and maps the row", async () => {
      const row = makeRow();
      const findFirst = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when there is no run for the issue", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-999");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) in the query", async () => {
      const row = makeRow({ state: "Planning" });
      const findFirst = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Planning);
    });

    it("returns null when no active run exists for the issue", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and maps the resulting row", async () => {
      const row = makeRow({ state: "Implementing" });
      const update = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ update });
      const repo = new RunRepository(prisma);

      const result = await repo.updateState("run-1", RunState.Implementing);

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Implementing" },
      });
      expect(result.state).toBe(RunState.Implementing);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing a title or description via OR", async () => {
      const rows = [makeRow({ linearIssueTitle: null })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when no runs need backfill", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data through to prisma and maps the resulting row", async () => {
      const row = makeRow({ branchName: "ai/run-1", prNumber: 42 });
      const update = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ update });
      const repo = new RunRepository(prisma);

      const result = await repo.update("run-1", { branchName: "ai/run-1", prNumber: 42 });

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/run-1", prNumber: 42 },
      });
      expect(result.branchName).toBe("ai/run-1");
      expect(result.prNumber).toBe(42);
    });
  });
});
