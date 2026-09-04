import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

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
    it("creates a run with Todo state and maps optional fields to null when omitted", async () => {
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
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
      expect(result.id).toBe("run-1");
      expect(result.linearIssueIdentifier).toBeNull();
      expect(result.state).toBe(RunState.Todo);
    });

    it("passes through provided optional fields", async () => {
      const row = makeRow();
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
        data: expect.objectContaining({
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
        }),
      });
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when stateFilter is undefined", async () => {
      const findMany = vi.fn().mockResolvedValue([makeRow()]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("queries with no where clause when stateFilter is an empty/blank string", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findAll("  ,  ,");

      expect(findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by a single state when stateFilter has one value", async () => {
      const findMany = vi.fn().mockResolvedValue([makeRow({ state: "Planning" })]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll("Planning");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
      expect(result[0].state).toBe(RunState.Planning);
    });

    it("filters by multiple states (comma-separated, trimmed) using an `in` clause", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning, Todo ,Done");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "Todo", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps an empty result set to an empty array", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();
      expect(result).toEqual([]);
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
    it("queries by linearIssueId ordered by createdAt desc and returns the mapped run", async () => {
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

    it("returns null when no run matches", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-404");
      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const row = makeRow({ state: "Implementing" });
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
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when there is no active run for the issue", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      const result = await repo.findActiveByIssueId("LIN-1");
      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped run", async () => {
      const row = makeRow({ state: "Done" });
      const update = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ update });
      const repo = new RunRepository(prisma);

      const result = await repo.updateState("run-1", RunState.Done);

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Done" },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs with a null title or null description", async () => {
      const rows = [makeRow({ linearIssueTitle: null }), makeRow({ linearIssueDescription: null })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(2);
    });

    it("returns an empty array when nothing needs backfill", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();
      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data through to prisma and returns the mapped run", async () => {
      const row = makeRow({ branchName: "ai/lin-1", prNumber: 42 });
      const update = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ update });
      const repo = new RunRepository(prisma);

      const result = await repo.update("run-1", { branchName: "ai/lin-1", prNumber: 42 });

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/lin-1", prNumber: 42 },
      });
      expect(result.branchName).toBe("ai/lin-1");
      expect(result.prNumber).toBe(42);
    });
  });
});
