import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
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
  };
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run with defaulted optional fields and state Todo, returning the domain object", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

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
      expect(result).toEqual({ ...row, state: RunState.Todo });
    });

    it("passes through provided optional fields instead of defaulting to null", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test-repo",
        workingDirectory: "/tmp",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
        }),
      });
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no state filter is given", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("filters by a single state when one state is given", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Implementing");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Implementing" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple states using an 'in' clause, trimming whitespace", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll(" Todo , Planning ,AIReview");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "AIReview"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("drops empty entries produced by stray commas / whitespace-only filter", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      // Only whitespace -> filtered out entirely -> states.length === 0 -> where stays undefined
      await repo.findAll("   ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every row to a domain object", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ id: "run-1" }), makeRow({ id: "run-2" })]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["run-1", "run-2"]);
    });
  });

  describe("findById", () => {
    it("returns the mapped domain object when found", async () => {
      const prisma = makePrisma();
      const row = makeRow({ id: "run-42" });
      prisma.aiRun.findUnique.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("run-42");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
      expect(result?.id).toBe("run-42");
    });

    it("returns null when not found", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by most recent, returns mapped result", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiRun.findFirst.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run matches the issue id", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("LIN-none");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) via notIn", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiRun.findFirst.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

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
      const prisma = makePrisma();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state field and returns the mapped domain object", async () => {
      const prisma = makePrisma();
      const row = makeRow({ state: "Planning" });
      prisma.aiRun.update.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      const result = await repo.updateState("run-1", RunState.Planning);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Planning" },
      });
      expect(result.state).toBe(RunState.Planning);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries for runs with a null title or null description via OR", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when nothing needs backfill", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data straight through to prisma and maps the result", async () => {
      const prisma = makePrisma();
      const row = makeRow({ branchName: "ai/run-1", prNumber: 7 });
      prisma.aiRun.update.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

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
