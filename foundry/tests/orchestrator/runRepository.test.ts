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
    planVersion: 0,
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
    it("calls prisma.aiRun.create with defaulted nullable fields and state 'Todo', and maps the row", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
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
      expect(result.state).toBe(RunState.Todo);
    });

    it("passes through optional fields when provided", async () => {
      const prisma = makePrisma();
      const row = makeRow({
        linearIssueIdentifier: "ENG-42",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
      });
      prisma.aiRun.create.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-42",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "ENG-42",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
        }),
      });
    });

    it("propagates errors from prisma.aiRun.create", async () => {
      const prisma = makePrisma();
      prisma.aiRun.create.mockRejectedValue(new Error("insert failed"));
      const repo = new RunRepository(prisma as never);

      await expect(
        repo.create({ linearIssueId: "LIN-1", repo: "test-repo", workingDirectory: "/tmp" }),
      ).rejects.toThrow("insert failed");
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

    it("queries with no where clause when stateFilter is an empty/blank string", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll(" , ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("uses a single-state equality filter for a single state", async () => {
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

    it("trims whitespace around a single state", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("  Planning  ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("uses an 'in' filter for multiple comma-separated states, trimming and dropping blanks", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      await repo.findAll("Planning, Todo ,,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "Todo", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps multiple returned rows to domain objects", async () => {
      const prisma = makePrisma();
      const rows = [makeRow({ id: "r1", state: "Todo" }), makeRow({ id: "r2", state: "Done" })];
      prisma.aiRun.findMany.mockResolvedValue(rows);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findAll("Todo,Done");

      expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
      expect(result.map((r) => r.state)).toEqual([RunState.Todo, RunState.Done]);
    });

    it("propagates errors from prisma.aiRun.findMany", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockRejectedValue(new Error("db down"));
      const repo = new RunRepository(prisma as never);

      await expect(repo.findAll()).rejects.toThrow("db down");
    });
  });

  describe("findById", () => {
    it("queries by id and maps a found row", async () => {
      const prisma = makePrisma();
      const row = makeRow();
      prisma.aiRun.findUnique.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when no run is found", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });

    it("propagates errors from prisma.aiRun.findUnique", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findUnique.mockRejectedValue(new Error("timeout"));
      const repo = new RunRepository(prisma as never);

      await expect(repo.findById("run-1")).rejects.toThrow("timeout");
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by createdAt desc and maps a found row", async () => {
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

      const result = await repo.findByIssueId("LIN-missing");

      expect(result).toBeNull();
    });

    it("propagates errors from prisma.aiRun.findFirst", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findFirst.mockRejectedValue(new Error("boom"));
      const repo = new RunRepository(prisma as never);

      await expect(repo.findByIssueId("LIN-1")).rejects.toThrow("boom");
    });
  });

  describe("findActiveByIssueId", () => {
    it("queries by linearIssueId excluding terminal states, ordered by createdAt desc", async () => {
      const prisma = makePrisma();
      const row = makeRow({ state: "Implementing" });
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
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when only terminal runs exist for the issue", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });

    it("propagates errors from prisma.aiRun.findFirst", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findFirst.mockRejectedValue(new Error("fail"));
      const repo = new RunRepository(prisma as never);

      await expect(repo.findActiveByIssueId("LIN-1")).rejects.toThrow("fail");
    });
  });

  describe("updateState", () => {
    it("calls prisma.aiRun.update with the new state and maps the resulting row", async () => {
      const prisma = makePrisma();
      const row = makeRow({ state: "Done" });
      prisma.aiRun.update.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      const result = await repo.updateState("run-1", RunState.Done);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Done" },
      });
      expect(result.state).toBe(RunState.Done);
    });

    it("propagates errors from prisma.aiRun.update", async () => {
      const prisma = makePrisma();
      prisma.aiRun.update.mockRejectedValue(new Error("conflict"));
      const repo = new RunRepository(prisma as never);

      await expect(repo.updateState("run-1", RunState.Failed)).rejects.toThrow("conflict");
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries with an OR clause for missing title or description and maps every row", async () => {
      const prisma = makePrisma();
      const rows = [
        makeRow({ id: "r1", linearIssueTitle: null }),
        makeRow({ id: "r2", linearIssueDescription: null }),
      ];
      prisma.aiRun.findMany.mockResolvedValue(rows);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
    });

    it("returns an empty array when no runs need backfill", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as never);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });

    it("propagates errors from prisma.aiRun.findMany", async () => {
      const prisma = makePrisma();
      prisma.aiRun.findMany.mockRejectedValue(new Error("db down"));
      const repo = new RunRepository(prisma as never);

      await expect(repo.findRunsNeedingLinearBackfill()).rejects.toThrow("db down");
    });
  });

  describe("update", () => {
    it("passes the partial data object straight through to prisma.aiRun.update and maps the row", async () => {
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

    it("supports updating multiple allow-listed fields at once", async () => {
      const prisma = makePrisma();
      const row = makeRow({ planVersion: 3, approvedPlanVersion: 2, latestArtifactVersion: 5 });
      prisma.aiRun.update.mockResolvedValue(row);
      const repo = new RunRepository(prisma as never);

      await repo.update("run-1", {
        planVersion: 3,
        approvedPlanVersion: 2,
        latestArtifactVersion: 5,
      });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { planVersion: 3, approvedPlanVersion: 2, latestArtifactVersion: 5 },
      });
    });

    it("propagates errors from prisma.aiRun.update", async () => {
      const prisma = makePrisma();
      prisma.aiRun.update.mockRejectedValue(new Error("not found"));
      const repo = new RunRepository(prisma as never);

      await expect(repo.update("run-1", { branchName: "x" })).rejects.toThrow("not found");
    });
  });
});
