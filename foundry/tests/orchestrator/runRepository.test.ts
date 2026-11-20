import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
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
  let prisma: ReturnType<typeof makePrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new RunRepository(prisma as never);
  });

  describe("create", () => {
    it("calls aiRun.create with defaults for optional fields and state Todo, returns mapped Run", async () => {
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);

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
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
        }),
      });
    });

    it("propagates errors from prisma", async () => {
      prisma.aiRun.create.mockRejectedValue(new Error("db down"));
      await expect(
        repo.create({ linearIssueId: "LIN-1", repo: "r", workingDirectory: "/tmp" }),
      ).rejects.toThrow("db down");
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no stateFilter is given", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
      const result = await repo.findAll();
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("builds an equality where clause for a single state", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an `in` where clause for multiple comma-separated states, trimming whitespace", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo, Planning ,Done");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("ignores an empty stateFilter string (no states after filtering)", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll(",, ,");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every row to a domain Run", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ id: "a" }), makeRow({ id: "b" })]);
      const result = await repo.findAll();
      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    });
  });

  describe("findById", () => {
    it("returns the mapped Run when found", async () => {
      prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-x" }));
      const result = await repo.findById("run-x");
      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-x" } });
      expect(result?.id).toBe("run-x");
    });

    it("returns null when not found", async () => {
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by createdAt desc and maps the result", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ linearIssueId: "LIN-9" }));
      const result = await repo.findByIssueId("LIN-9");
      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-9" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-9");
    });

    it("returns null when no run matches", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const result = await repo.findByIssueId("LIN-missing");
      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
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
    it("updates the run's state and returns the mapped Run", async () => {
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Planning" }));
      const result = await repo.updateState("run-1", RunState.Planning);
      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Planning" },
      });
      expect(result.state).toBe(RunState.Planning);
    });

    it("propagates errors from prisma", async () => {
      prisma.aiRun.update.mockRejectedValue(new Error("not found"));
      await expect(repo.updateState("missing", RunState.Done)).rejects.toThrow("not found");
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing title or description via OR", async () => {
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
    it("forwards partial data to prisma update and maps the result", async () => {
      prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/lin-1", prNumber: 42 }));
      const result = await repo.update("run-1", { branchName: "ai/lin-1", prNumber: 42 });
      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/lin-1", prNumber: 42 },
      });
      expect(result.branchName).toBe("ai/lin-1");
      expect(result.prNumber).toBe(42);
    });

    it("propagates errors from prisma", async () => {
      prisma.aiRun.update.mockRejectedValue(new Error("constraint violation"));
      await expect(repo.update("run-1", { prNumber: 1 })).rejects.toThrow(
        "constraint violation",
      );
    });
  });
});
