import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/issue-1",
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("RunRepository", () => {
  describe("create", () => {
    it("defaults optional linearIssue* fields to null and sets initial state Todo", async () => {
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
      const create = vi.fn().mockResolvedValue(row);
      const prisma = { aiRun: { create } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.create({
        linearIssueId: "issue-1",
        repo: "org/repo",
        workingDirectory: "/tmp/work",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "issue-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "org/repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.linearIssueIdentifier).toBeNull();
    });

    it("passes through the optional linearIssue* fields when provided", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = { aiRun: { create } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      await repo.create({
        linearIssueId: "issue-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue-1",
        repo: "org/repo",
        workingDirectory: "/tmp/work",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "issue-1",
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue-1",
          repo: "org/repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries with where: undefined when no stateFilter is given", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = { aiRun: { findMany } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      await repo.findAll();

      expect(findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("queries with where: { state: X } for a single state", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = { aiRun: { findMany } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      await repo.findAll("Todo");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("queries with where: { state: { in: [...] } } for a comma-separated multi-state filter, trimming whitespace and dropping empty segments", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = { aiRun: { findMany } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      await repo.findAll("Todo, Planning ,,Done");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row through toDomain", async () => {
      const rows = [makeRow({ id: "run-1" }), makeRow({ id: "run-2", state: "Done" })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = { aiRun: { findMany } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(result).toHaveLength(2);
      expect(result[1].state).toBe(RunState.Done);
    });
  });

  describe("findById", () => {
    it("returns the mapped domain object when found", async () => {
      const row = makeRow();
      const findUnique = vi.fn().mockResolvedValue(row);
      const prisma = { aiRun: { findUnique } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.findById("run-1");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const prisma = { aiRun: { findUnique } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by createdAt desc and returns mapped row", async () => {
      const row = makeRow();
      const findFirst = vi.fn().mockResolvedValue(row);
      const prisma = { aiRun: { findFirst } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("issue-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "issue-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("issue-1");
    });

    it("returns null when not found", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = { aiRun: { findFirst } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("missing");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes TERMINAL_STATES (Done, Failed) via notIn", async () => {
      const row = makeRow({ state: "Implementing" });
      const findFirst = vi.fn().mockResolvedValue(row);
      const prisma = { aiRun: { findFirst } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.findActiveByIssueId("issue-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "issue-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when no active run is found", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = { aiRun: { findFirst } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.findActiveByIssueId("issue-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped domain object", async () => {
      const row = makeRow({ state: "Planning" });
      const update = vi.fn().mockResolvedValue(row);
      const prisma = { aiRun: { update } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.updateState("run-1", RunState.Planning);

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Planning" },
      });
      expect(result.state).toBe(RunState.Planning);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries with the OR clause for missing title or description and maps rows", async () => {
      const rows = [makeRow({ linearIssueTitle: null }), makeRow({ linearIssueDescription: null })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = { aiRun: { findMany } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("passes the partial data through to prisma update and returns the mapped domain object", async () => {
      const row = makeRow({ branchName: "feature/x", prNumber: 42 });
      const update = vi.fn().mockResolvedValue(row);
      const prisma = { aiRun: { update } } as unknown as PrismaClient;
      const repo = new RunRepository(prisma);

      const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 42 });

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feature/x", prNumber: 42 },
      });
      expect(result.branchName).toBe("feature/x");
      expect(result.prNumber).toBe(42);
    });
  });
});
