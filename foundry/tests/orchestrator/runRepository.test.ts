import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
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
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
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
    it("creates a run with state Todo and nullish defaults for optional fields", async () => {
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      const result = await repo.create({
        linearIssueId: "issue-1",
        repo: "org/repo",
        workingDirectory: "/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueId: "issue-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "org/repo",
          workingDirectory: "/work",
          state: "Todo",
        }),
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("passes through provided optional linear fields instead of defaulting to null", async () => {
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      await repo.create({
        linearIssueId: "issue-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue-1",
        repo: "org/repo",
        workingDirectory: "/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue-1",
        }),
      });
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when no state filter is given", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("builds a single-state where clause for one state", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Implementing");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Implementing" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an 'in' where clause for a comma-separated multi-state filter, trimming whitespace", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Todo, Implementing ,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Implementing", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("drops empty entries produced by trailing/duplicate commas", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Todo,,Done,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an all-empty filter string (e.g. just commas) as no filter at all", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll(",,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const result = await repo.findById("run-1");
      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the most recent mapped run for an issue id", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const result = await repo.findByIssueId("issue-1");
      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "issue-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("issue-1");
    });

    it("returns null when no run exists for the issue", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await repo.findByIssueId("missing");
      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) via notIn", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ state: "Implementing" }),
      );

      const result = await repo.findActiveByIssueId("issue-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "issue-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when the only runs for the issue are terminal", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await repo.findActiveByIssueId("issue-1");
      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("persists the new state and returns the mapped run", async () => {
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ state: "Failed" }),
      );

      const result = await repo.updateState("run-1", RunState.Failed);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Failed" },
      });
      expect(result.state).toBe(RunState.Failed);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries with an OR over missing title/description", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ linearIssueTitle: null }),
      ]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when nothing needs backfill", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await repo.findRunsNeedingLinearBackfill();
      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("forwards a partial patch and returns the mapped result", async () => {
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ branchName: "feature/x", prNumber: 42 }),
      );

      const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 42 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feature/x", prNumber: 42 },
      });
      expect(result.branchName).toBe("feature/x");
      expect(result.prNumber).toBe(42);
    });
  });
});
