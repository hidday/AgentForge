import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrisma(overrides: {
  create?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
  findFirst?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}) {
  return {
    aiRun: {
      create: overrides.create ?? vi.fn(),
      findMany: overrides.findMany ?? vi.fn(),
      findUnique: overrides.findUnique ?? vi.fn(),
      findFirst: overrides.findFirst ?? vi.fn(),
      update: overrides.update ?? vi.fn(),
    },
  } as unknown as PrismaClient;
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
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
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work/run-1",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates a run with state Todo and null-coalesced optional fields", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const repo = new RunRepository(makePrisma({ create }));

      const result = await repo.create({
        linearIssueId: "issue-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue-1",
        repo: "org/repo",
        workingDirectory: "/work/run-1",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "issue-1",
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue-1",
          repo: "org/repo",
          workingDirectory: "/work/run-1",
          state: "Todo",
        },
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("defaults omitted optional linear fields to null", async () => {
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
      const create = vi.fn().mockResolvedValue(row);
      const repo = new RunRepository(makePrisma({ create }));

      await repo.create({
        linearIssueId: "issue-2",
        repo: "org/repo2",
        workingDirectory: "/work/run-2",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "issue-2",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "org/repo2",
          workingDirectory: "/work/run-2",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no stateFilter is given, ordered by createdAt desc", async () => {
      const findMany = vi.fn().mockResolvedValue([makeRow()]);
      const repo = new RunRepository(makePrisma({ findMany }));

      const result = await repo.findAll();

      expect(findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });

    it("builds a single-state where clause for a single-value stateFilter", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repo = new RunRepository(makePrisma({ findMany }));

      await repo.findAll("Planning");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an 'in' where clause for a multi-value comma-separated stateFilter, trimming whitespace", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repo = new RunRepository(makePrisma({ findMany }));

      await repo.findAll("Planning, Implementing , Done");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "Implementing", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("falls back to no where clause when stateFilter is an empty/blank string", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repo = new RunRepository(makePrisma({ findMany }));

      await repo.findAll("   ");

      expect(findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("drops empty segments produced by stray commas", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repo = new RunRepository(makePrisma({ findMany }));

      await repo.findAll("Planning,,Done");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row to domain shape", async () => {
      const rows = [makeRow({ id: "run-a" }), makeRow({ id: "run-b", state: "Done" })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const repo = new RunRepository(makePrisma({ findMany }));

      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["run-a", "run-b"]);
      expect(result[1].state).toBe(RunState.Done);
    });
  });

  describe("findById", () => {
    it("queries by id and maps a found row", async () => {
      const row = makeRow();
      const findUnique = vi.fn().mockResolvedValue(row);
      const repo = new RunRepository(makePrisma({ findUnique }));

      const result = await repo.findById("run-1");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when no run matches the id", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const repo = new RunRepository(makePrisma({ findUnique }));

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by createdAt desc and maps a found row", async () => {
      const row = makeRow();
      const findFirst = vi.fn().mockResolvedValue(row);
      const repo = new RunRepository(makePrisma({ findFirst }));

      const result = await repo.findByIssueId("issue-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "issue-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("issue-1");
    });

    it("returns null when no run matches the issue id", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const repo = new RunRepository(makePrisma({ findFirst }));

      const result = await repo.findByIssueId("missing-issue");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("queries by linearIssueId excluding terminal states (Done, Failed)", async () => {
      const row = makeRow({ state: "Implementing" });
      const findFirst = vi.fn().mockResolvedValue(row);
      const repo = new RunRepository(makePrisma({ findFirst }));

      const result = await repo.findActiveByIssueId("issue-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "issue-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when the only matching runs are terminal (none active)", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const repo = new RunRepository(makePrisma({ findFirst }));

      const result = await repo.findActiveByIssueId("issue-done-only");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state by id and maps the row", async () => {
      const row = makeRow({ state: "Done" });
      const update = vi.fn().mockResolvedValue(row);
      const repo = new RunRepository(makePrisma({ update }));

      const result = await repo.updateState("run-1", RunState.Done);

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: RunState.Done },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing a title or description via OR", async () => {
      const rows = [makeRow({ linearIssueTitle: null })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const repo = new RunRepository(makePrisma({ findMany }));

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when every run already has title and description", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repo = new RunRepository(makePrisma({ findMany }));

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data payload through to prisma.aiRun.update and maps the result", async () => {
      const row = makeRow({ branchName: "feature/x", prNumber: 42 });
      const update = vi.fn().mockResolvedValue(row);
      const repo = new RunRepository(makePrisma({ update }));

      const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 42 });

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feature/x", prNumber: 42 },
      });
      expect(result.branchName).toBe("feature/x");
      expect(result.prNumber).toBe(42);
    });

    it("supports updating a single field such as approvedPlanVersion", async () => {
      const row = makeRow({ approvedPlanVersion: 3 });
      const update = vi.fn().mockResolvedValue(row);
      const repo = new RunRepository(makePrisma({ update }));

      const result = await repo.update("run-1", { approvedPlanVersion: 3 });

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { approvedPlanVersion: 3 },
      });
      expect(result.approvedPlanVersion).toBe(3);
    });
  });
});
