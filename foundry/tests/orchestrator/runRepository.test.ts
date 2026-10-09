import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
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
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
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
  } as unknown as PrismaClient;
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run with defaults filled in and maps the result to a domain Run", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new RunRepository(prisma);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue/ENG-1",
        repo: "org/repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue/ENG-1",
          repo: "org/repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("defaults optional linear fields to null when omitted", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new RunRepository(prisma);

      await repo.create({
        linearIssueId: "LIN-1",
        repo: "org/repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "org/repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no state filter is given", async () => {
      const prisma = makePrismaMock();
      const rows = [makeRow()];
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual([{ ...rows[0], state: RunState.Todo }]);
    });

    it("builds a single-state where clause for one state", async () => {
      const prisma = makePrismaMock();
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      await repo.findAll("Todo");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds a multi-state 'in' where clause, trimming whitespace and dropping empties", async () => {
      const prisma = makePrismaMock();
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      await repo.findAll(" Todo , Planning ,,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty/whitespace-only filter as no filter", async () => {
      const prisma = makePrismaMock();
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      await repo.findAll("  ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new RunRepository(prisma);

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("returns null when not found", async () => {
      const prisma = makePrismaMock();
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new RunRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the mapped run when found, ordered by most recent", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("returns null when no run exists for the issue", async () => {
      const prisma = makePrismaMock();
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-404");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states and returns the mapped run", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({ state: "Implementing" });
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new RunRepository(prisma);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual({ ...row, state: RunState.Implementing });
    });

    it("returns null when no active run exists", async () => {
      const prisma = makePrismaMock();
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new RunRepository(prisma);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state field and returns the mapped run", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({ state: "Done" });
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new RunRepository(prisma);

      const result = await repo.updateState("run-1", RunState.Done);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Done" },
      });
      expect(result).toEqual({ ...row, state: RunState.Done });
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing title or description and maps each result", async () => {
      const prisma = makePrismaMock();
      const rows = [makeRow({ linearIssueTitle: null }), makeRow({ linearIssueDescription: null })];
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toEqual(rows.map((r) => ({ ...r, state: RunState.Todo })));
    });

    it("returns an empty array when nothing needs backfill", async () => {
      const prisma = makePrismaMock();
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes partial data through and maps the result", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({ branchName: "feature/x", prNumber: 42 });
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new RunRepository(prisma);

      const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 42 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feature/x", prNumber: 42 },
      });
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });
  });
});
