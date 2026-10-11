import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://example.com",
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    aiRun: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      ...overrides,
    },
  } as never;
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run with Todo state and maps optional fields to null when omitted", async () => {
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new RunRepository(prisma);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(create).toHaveBeenCalledWith({
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
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("passes through provided optional fields", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new RunRepository(prisma);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://example.com",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://example.com",
        }),
      });
    });

    it("propagates errors from the underlying create call", async () => {
      const create = vi.fn().mockRejectedValue(new Error("db down"));
      const prisma = makePrisma({ create });
      const repo = new RunRepository(prisma);

      await expect(
        repo.create({ linearIssueId: "LIN-1", repo: "test-repo", workingDirectory: "/tmp" }),
      ).rejects.toThrow("db down");
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no filter is given", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(findMany).toHaveBeenCalledWith({ where: undefined, orderBy: { createdAt: "desc" } });
      expect(result).toEqual([]);
    });

    it("builds an equality where clause for a single state", async () => {
      const findMany = vi.fn().mockResolvedValue([makeRow({ state: "Done" })]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll("Done");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: "Done" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Done);
    });

    it("builds an 'in' where clause for multiple comma-separated states, trimming whitespace", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findAll("Done, Failed , Todo");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Done", "Failed", "Todo"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an all-whitespace/empty filter as no filter", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findAll("");

      expect(findMany).toHaveBeenCalledWith({ where: undefined, orderBy: { createdAt: "desc" } });
    });

    it("preserves row order and maps each row to a domain Run", async () => {
      const rows = [makeRow({ id: "a" }), makeRow({ id: "b" }), makeRow({ id: "c" })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
    });
  });

  describe("findById", () => {
    it("returns the mapped domain object when found", async () => {
      const findUnique = vi.fn().mockResolvedValue(makeRow({ id: "run-42" }));
      const prisma = makePrisma({ findUnique });
      const repo = new RunRepository(prisma);

      const result = await repo.findById("run-42");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
      expect(result?.id).toBe("run-42");
    });

    it("returns null when not found", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findUnique });
      const repo = new RunRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by createdAt desc and maps the result", async () => {
      const findFirst = vi.fn().mockResolvedValue(makeRow());
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run matches", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      expect(await repo.findByIssueId("LIN-404")).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const findFirst = vi.fn().mockResolvedValue(makeRow({ state: "Implementing" }));
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when there is no active run", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      expect(await repo.findActiveByIssueId("LIN-1")).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped domain object", async () => {
      const update = vi.fn().mockResolvedValue(makeRow({ state: "PlanReview" }));
      const prisma = makePrisma({ update });
      const repo = new RunRepository(prisma);

      const result = await repo.updateState("run-1", RunState.PlanReview);

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "PlanReview" },
      });
      expect(result.state).toBe(RunState.PlanReview);
    });

    it("propagates errors from the update call", async () => {
      const update = vi.fn().mockRejectedValue(new Error("constraint violation"));
      const prisma = makePrisma({ update });
      const repo = new RunRepository(prisma);

      await expect(repo.updateState("run-1", RunState.Failed)).rejects.toThrow(
        "constraint violation",
      );
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries for runs with a null title or description", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findRunsNeedingLinearBackfill();

      expect(findMany).toHaveBeenCalledWith({
        where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
      });
    });

    it("maps multiple rows while preserving order", async () => {
      const rows = [makeRow({ id: "x" }), makeRow({ id: "y" })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result.map((r) => r.id)).toEqual(["x", "y"]);
    });
  });

  describe("update", () => {
    it("forwards the partial data payload and returns the mapped result", async () => {
      const update = vi.fn().mockResolvedValue(makeRow({ branchName: "ai/lin-1", prNumber: 7 }));
      const prisma = makePrisma({ update });
      const repo = new RunRepository(prisma);

      const result = await repo.update("run-1", { branchName: "ai/lin-1", prNumber: 7 });

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/lin-1", prNumber: 7 },
      });
      expect(result.branchName).toBe("ai/lin-1");
      expect(result.prNumber).toBe(7);
    });
  });
});
