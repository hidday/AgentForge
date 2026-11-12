import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/workspace/acme/repo",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeFakePrisma() {
  const aiRun = {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  };
  return { aiRun };
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run in Todo state with nulls for omitted optional fields", async () => {
      const prisma = makeFakePrisma();
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      const result = await repo.create({
        linearIssueId: "lin-1",
        repo: "acme/repo",
        workingDirectory: "/workspace/acme/repo",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "lin-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "acme/repo",
          workingDirectory: "/workspace/acme/repo",
          state: "Todo",
        },
      });
      expect(result.id).toBe("run-1");
      expect(result.state).toBe(RunState.Todo);
    });

    it("passes through optional linear fields when provided", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.create.mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma as never);

      await repo.create({
        linearIssueId: "lin-1",
        linearIssueIdentifier: "PRY-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "acme/repo",
        workingDirectory: "/workspace/acme/repo",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "PRY-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
        }),
      });
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when stateFilter is omitted", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });

    it("filters by a single state", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple comma-separated states", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Planning, Implementing");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "Implementing"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an all-blank stateFilter as no filter", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll(" , ,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row to the domain Run shape", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ id: "r1" }), makeRow({ id: "r2" })]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findUnique.mockResolvedValue(makeRow({ state: "Implementing" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when not found", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      expect(await repo.findById("missing")).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries the most recent run for the issue", async () => {
      const prisma = makeFakePrisma();
      const row = makeRow();
      prisma.aiRun.findFirst.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findByIssueId("lin-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "lin-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when the issue has no runs", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      expect(await repo.findByIssueId("lin-1")).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed)", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("lin-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "lin-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when there is no active run for the issue", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      expect(await repo.findActiveByIssueId("lin-1")).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped row", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Done" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.updateState("run-1", RunState.Done);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: RunState.Done },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing title or description", async () => {
      const prisma = makeFakePrisma();
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

    it("returns an empty array when nothing needs backfilling", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      expect(await repo.findRunsNeedingLinearBackfill()).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data straight through to prisma and returns the mapped row", async () => {
      const prisma = makeFakePrisma();
      prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/lin-1", prNumber: 42 }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.update("run-1", { branchName: "ai/lin-1", prNumber: 42 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/lin-1", prNumber: 42 },
      });
      expect(result.branchName).toBe("ai/lin-1");
      expect(result.prNumber).toBe(42);
    });
  });
});
