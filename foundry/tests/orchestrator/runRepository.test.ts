import { describe, it, expect, vi, beforeEach } from "vitest";
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
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
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
  let prisma: ReturnType<typeof makePrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new RunRepository(prisma as never);
  });

  describe("create", () => {
    it("creates a run with defaults for optional fields and state Todo", async () => {
      prisma.aiRun.create.mockResolvedValue(makeRow({ linearIssueIdentifier: null, linearIssueDescription: null, linearIssueTitle: null, linearIssueUrl: null }));

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/wd",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "test-repo",
          workingDirectory: "/tmp/wd",
          state: "Todo",
        },
      });
      expect(result.id).toBe("run-1");
      expect(result.state).toBe(RunState.Todo);
    });

    it("passes through optional fields when provided", async () => {
      prisma.aiRun.create.mockResolvedValue(makeRow());

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test-repo",
        workingDirectory: "/tmp/wd",
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
    it("queries with no where clause when stateFilter is omitted", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
      const result = await repo.findAll();
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("queries with no where clause when stateFilter is empty string", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("queries with no where clause when stateFilter is only commas/whitespace", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll(" , , ");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an equality where clause for a single state", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("trims whitespace around a single state", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("  Todo  ");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an 'in' where clause for multiple states", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo,Planning, Done");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row to the domain shape", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ id: "a" }), makeRow({ id: "b" })]);
      const result = await repo.findAll();
      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      prisma.aiRun.findUnique.mockResolvedValue(makeRow());
      const result = await repo.findById("run-1");
      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the mapped run when found", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow());
      const result = await repo.findByIssueId("LIN-1");
      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when not found", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const result = await repo.findByIssueId("LIN-missing");
      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states from the query", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow());
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

    it("returns null when no active run exists", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const result = await repo.findActiveByIssueId("LIN-1");
      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state and returns the mapped run", async () => {
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Planning" }));
      const result = await repo.updateState("run-1", RunState.Planning);
      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Planning" },
      });
      expect(result.state).toBe(RunState.Planning);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries for runs missing title or description", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);
      const result = await repo.findRunsNeedingLinearBackfill();
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when nothing needs backfill", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      const result = await repo.findRunsNeedingLinearBackfill();
      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes partial data through and returns the mapped run", async () => {
      prisma.aiRun.update.mockResolvedValue(makeRow({ prNumber: 42 }));
      const result = await repo.update("run-1", { prNumber: 42 });
      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { prNumber: 42 },
      });
      expect(result.prNumber).toBe(42);
    });
  });
});
