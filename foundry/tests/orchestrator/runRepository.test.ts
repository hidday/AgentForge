import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/x",
    repo: "org/repo",
    branchName: "feat/x",
    prNumber: 42,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

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

describe("RunRepository", () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    mockPrisma = makeMockPrisma();
    repo = new RunRepository(mockPrisma as never);
  });

  describe("create", () => {
    it("passes all provided fields to prisma and maps the returned row to a Run with state cast", async () => {
      const row = makeRow({ state: "Todo" });
      mockPrisma.aiRun.create.mockResolvedValue(row);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "Title",
        linearIssueUrl: "https://linear.app/x",
        repo: "org/repo",
        workingDirectory: "/tmp/work",
      });

      expect(mockPrisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "Title",
          linearIssueUrl: "https://linear.app/x",
          repo: "org/repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("defaults optional linear fields to null when omitted", async () => {
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
      mockPrisma.aiRun.create.mockResolvedValue(row);

      await repo.create({
        linearIssueId: "LIN-2",
        repo: "org/repo",
        workingDirectory: "/tmp/work2",
      });

      expect(mockPrisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-2",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "org/repo",
          workingDirectory: "/tmp/work2",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when stateFilter is omitted, ordered by createdAt desc", async () => {
      mockPrisma.aiRun.findMany.mockResolvedValue([makeRow()]);

      const result = await repo.findAll();

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Planning);
    });

    it("builds a single-state where clause for one state", async () => {
      mockPrisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("Todo");

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an 'in' where clause for multiple comma-separated states, trimming whitespace", async () => {
      mockPrisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("Todo, Planning ,Done");

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("leaves where undefined when the filter string has only separators/whitespace", async () => {
      mockPrisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll(" , , ");

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every row through toDomain", async () => {
      mockPrisma.aiRun.findMany.mockResolvedValue([
        makeRow({ id: "a", state: "Todo" }),
        makeRow({ id: "b", state: "Done" }),
      ]);

      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
      expect(result.map((r) => r.state)).toEqual([RunState.Todo, RunState.Done]);
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      mockPrisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-x" }));

      const result = await repo.findById("run-x");

      expect(mockPrisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-x" } });
      expect(result?.id).toBe("run-x");
    });

    it("returns null when not found", async () => {
      mockPrisma.aiRun.findUnique.mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by createdAt desc and returns the mapped run", async () => {
      mockPrisma.aiRun.findFirst.mockResolvedValue(makeRow({ linearIssueId: "LIN-9" }));

      const result = await repo.findByIssueId("LIN-9");

      expect(mockPrisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-9" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-9");
    });

    it("returns null when no run exists for the issue", async () => {
      mockPrisma.aiRun.findFirst.mockResolvedValue(null);

      const result = await repo.findByIssueId("LIN-missing");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      mockPrisma.aiRun.findFirst.mockResolvedValue(makeRow());

      await repo.findActiveByIssueId("LIN-1");

      expect(mockPrisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when no active run exists", async () => {
      mockPrisma.aiRun.findFirst.mockResolvedValue(null);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state column and returns the mapped run", async () => {
      mockPrisma.aiRun.update.mockResolvedValue(makeRow({ id: "run-1", state: "Done" }));

      const result = await repo.updateState("run-1", RunState.Done);

      expect(mockPrisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Done" },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries for runs missing title or description via OR clause", async () => {
      mockPrisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(mockPrisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when no runs need backfill", async () => {
      mockPrisma.aiRun.findMany.mockResolvedValue([]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data through to prisma unchanged and maps the result", async () => {
      mockPrisma.aiRun.update.mockResolvedValue(
        makeRow({ id: "run-1", branchName: "feat/new", prNumber: 7 }),
      );

      const result = await repo.update("run-1", { branchName: "feat/new", prNumber: 7 });

      expect(mockPrisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feat/new", prNumber: 7 },
      });
      expect(result.branchName).toBe("feat/new");
      expect(result.prNumber).toBe(7);
    });
  });
});
