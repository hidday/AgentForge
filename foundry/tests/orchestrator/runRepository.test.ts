import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "PRY-1",
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
    workingDirectory: "/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
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
  let prisma: ReturnType<typeof makePrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new RunRepository(prisma);
  });

  describe("create", () => {
    it("passes through all optional fields when provided and returns the domain Run", async () => {
      const row = makeRow();
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.create({
        linearIssueId: "issue-1",
        linearIssueIdentifier: "PRY-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue-1",
        repo: "org/repo",
        workingDirectory: "/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "issue-1",
          linearIssueIdentifier: "PRY-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue-1",
          repo: "org/repo",
          workingDirectory: "/work",
          state: "Todo",
        },
      });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("defaults omitted optional fields to null", async () => {
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      await repo.create({
        linearIssueId: "issue-1",
        repo: "org/repo",
        workingDirectory: "/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "issue-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "org/repo",
          workingDirectory: "/work",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when no state filter is given", async () => {
      const rows = [makeRow()];
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(rows.map((r) => ({ ...r, state: RunState.Todo })));
    });

    it("builds a single-state where clause for one state", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Todo");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an 'in' where clause for multiple comma-separated states, trimming whitespace", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll(" Todo , Planning ,,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty/whitespace-only filter as no filter", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the domain Run when found", async () => {
      const row = makeRow();
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("returns null when not found", async () => {
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the most recent domain Run when found", async () => {
      const row = makeRow();
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.findByIssueId("issue-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "issue-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("returns null when no run exists for the issue", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findByIssueId("no-such-issue");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const row = makeRow({ state: "Implementing" });
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.findActiveByIssueId("issue-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "issue-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual({ ...row, state: RunState.Implementing });
    });

    it("returns null when there is no active run for the issue", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findActiveByIssueId("issue-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the domain Run", async () => {
      const row = makeRow({ state: "Failed" });
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.updateState("run-1", RunState.Failed);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Failed" },
      });
      expect(result).toEqual({ ...row, state: RunState.Failed });
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing title or description via OR clause", async () => {
      const rows = [makeRow({ linearIssueTitle: null })];
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toEqual(rows.map((r) => ({ ...r, state: RunState.Todo })));
    });

    it("returns an empty array when nothing needs backfill", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes through the partial data and returns the domain Run", async () => {
      const row = makeRow({ branchName: "feature/x", prNumber: 42 });
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 42 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feature/x", prNumber: 42 },
      });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });
  });
});
