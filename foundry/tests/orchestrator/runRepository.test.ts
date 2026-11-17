import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

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
    workingDirectory: "/tmp/repo",
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
  };
}

describe("RunRepository", () => {
  describe("create", () => {
    it("defaults optional linear fields to null and sets state to Todo", async () => {
      const prisma = makePrisma();
      prisma.aiRun.create.mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma as never);

      await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/repo",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "test-repo",
          workingDirectory: "/tmp/repo",
          state: "Todo",
        },
      });
    });

    it("forwards provided optional linear fields and maps the returned row to a domain Run", async () => {
      const prisma = makePrisma();
      prisma.aiRun.create.mockResolvedValue(
        makeRow({
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
        }),
      );
      const repo = new RunRepository(prisma as never);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test-repo",
        workingDirectory: "/tmp/repo",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
        }),
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when stateFilter is omitted", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("queries with no where clause when stateFilter is an empty string", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an equality where clause for a single state", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ state: "Planning" })]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Planning);
    });

    it("builds an `in` where clause for multiple comma-separated states, trimming whitespace", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Planning, PlanReview , Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "PlanReview", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("drops empty segments produced by stray commas and falls back to no where clause when nothing remains", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll(" , , ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("maps the row to a domain Run when found", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findUnique.mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when no row is found", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries the most recent matching run ordered by createdAt desc", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow());
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

      expect(await repo.findByIssueId("LIN-404")).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the active lookup", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when there is no active run for the issue", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      expect(await repo.findActiveByIssueId("LIN-1")).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and maps the result", async () => {
      const prisma = makePrisma();
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Done" }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.updateState("run-1", RunState.Done);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Done" },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing either the title or the description via an OR clause", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([makeRow(), makeRow({ id: "run-2" })]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("passes partial fields straight through to prisma and maps the result", async () => {
      const prisma = makePrisma();
      prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/run-1", prNumber: 42 }));
      const repo = new RunRepository(prisma as never);

      const result = await repo.update("run-1", { branchName: "ai/run-1", prNumber: 42 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/run-1", prNumber: 42 },
      });
      expect(result.branchName).toBe("ai/run-1");
      expect(result.prNumber).toBe(42);
    });
  });
});
