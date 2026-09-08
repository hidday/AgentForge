import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/issue/LIN-1",
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrismaMock() {
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
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new RunRepository(prisma);
  });

  describe("create", () => {
    it("creates a run with defaults for optional fields and state Todo", async () => {
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
      prisma.aiRun.create.mockResolvedValue(row);

      const result = await repo.create({
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
      expect(result.id).toBe("run-1");
      expect(result.state).toBe(RunState.Todo);
    });

    it("passes through optional fields when provided", async () => {
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue/LIN-1",
        repo: "org/repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue/LIN-1",
        }),
      });
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no filter is given", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("filters by a single state", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Done" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple comma-separated states, trimming whitespace and blanks", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("Done, Failed,,  Todo ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Done", "Failed", "Todo"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an all-blank filter string as no filter", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll(" , , ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns an empty array when no runs match", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      const result = await repo.findAll();

      expect(result).toEqual([]);
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-42" }));

      const result = await repo.findById("run-42");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
      expect(result?.id).toBe("run-42");
    });

    it("returns null when not found", async () => {
      prisma.aiRun.findUnique.mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the mapped run when found", async () => {
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
    it("excludes terminal states from the query", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow());

      await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when no active run exists", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped run", async () => {
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Implementing" }));

      const result = await repo.updateState("run-1", RunState.Implementing);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Implementing" },
      });
      expect(result.state).toBe(RunState.Implementing);
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
    it("passes the partial data through and returns the mapped run", async () => {
      prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/lin-1", prNumber: 5 }));

      const result = await repo.update("run-1", { branchName: "ai/lin-1", prNumber: 5 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/lin-1", prNumber: 5 },
      });
      expect(result.branchName).toBe("ai/lin-1");
      expect(result.prNumber).toBe(5);
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiRun.update.mockRejectedValue(new Error("row not found"));

      await expect(repo.update("missing", { branchName: "x" })).rejects.toThrow("row not found");
    });
  });
});
