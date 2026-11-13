import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/issue/1",
    repo: "org/repo",
    branchName: "feature/x",
    prNumber: 7,
    state: "Implementing",
    planVersion: 2,
    approvedPlanVersion: 1,
    plannerRuntime: "claude-code",
    executorRuntime: "claude-code",
    reviewerRuntime: "codex",
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 3,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
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
  } as unknown as PrismaClient & {
    aiRun: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
}

describe("RunRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new RunRepository(prisma);
  });

  describe("create", () => {
    it("passes required fields plus nullable defaults and initial state Todo to prisma", async () => {
      prisma.aiRun.create.mockResolvedValue(makeRow({ state: "Todo" }));

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

    it("forwards optional fields when provided and returns the mapped domain Run", async () => {
      const row = makeRow({ state: "Todo" });
      prisma.aiRun.create.mockResolvedValue(row);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-42",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue/1",
        repo: "org/repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "ENG-42",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue/1",
          repo: "org/repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when no filter is given, ordered by createdAt desc", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Implementing);
    });

    it("builds an exact-match where clause for a single state", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("Todo");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an `in` where clause for a comma-separated multi-state filter, trimming whitespace", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll(" Todo , Planning ,Implementing");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Implementing"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats a filter that is only whitespace/commas as no filter (boundary case)", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll(" , , ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row through toDomain", async () => {
      prisma.aiRun.findMany.mockResolvedValue([
        makeRow({ id: "a", state: "Todo" }),
        makeRow({ id: "b", state: "Done" }),
      ]);

      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
      expect(result.map((r) => r.state)).toEqual([RunState.Todo, RunState.Done]);
    });
  });

  describe("findById", () => {
    it("returns the mapped Run when found", async () => {
      prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-1" }));

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result).not.toBeNull();
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found (does not fabricate a Run)", async () => {
      prisma.aiRun.findUnique.mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by createdAt desc and returns the mapped Run", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ linearIssueId: "LIN-9" }));

      const result = await repo.findByIssueId("LIN-9");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-9" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-9");
    });

    it("returns null when no run matches the issue id", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);

      const result = await repo.findByIssueId("LIN-missing");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));

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

    it("returns null when the only matching runs are terminal (none active)", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state field and returns the mapped Run", async () => {
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Done" }));

      const result = await repo.updateState("run-1", RunState.Done);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Done" },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing title OR description, mapping all rows", async () => {
      prisma.aiRun.findMany.mockResolvedValue([
        makeRow({ id: "a", linearIssueTitle: null }),
        makeRow({ id: "b", linearIssueDescription: null }),
      ]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when nothing needs backfill", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("forwards the given partial data unchanged and returns the mapped Run", async () => {
      const data = { branchName: "feature/y", prNumber: 12, planVersion: 3 };
      prisma.aiRun.update.mockResolvedValue(makeRow({ ...data, id: "run-1" }));

      const result = await repo.update("run-1", data);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data,
      });
      expect(result.branchName).toBe("feature/y");
      expect(result.prNumber).toBe(12);
      expect(result.planVersion).toBe(3);
    });
  });
});
