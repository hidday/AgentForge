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
    linearIssueUrl: "https://linear.app/x/LIN-1",
    repo: "test-repo",
    branchName: "ai/lin-1",
    prNumber: 5,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: "claude-code",
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
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
  } as unknown as PrismaClient;
}

describe("RunRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new RunRepository(prisma);
  });

  describe("create", () => {
    it("creates a run with Todo state and null-coalesced optional fields", async () => {
      const row = makeRow();
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

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
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x/LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x/LIN-1",
          repo: "test-repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no state filter is given", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("filters by a single state when given one state", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Todo");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple comma-separated states using an `in` clause", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Todo, Planning ,AIReview");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "AIReview"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("ignores empty segments and surrounding whitespace in the filter", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Todo,,  ,Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an all-empty filter string as no filter (undefined where)", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll(" , , ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every row to its domain representation", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ id: "run-1" }),
        makeRow({ id: "run-2", state: RunState.Done }),
      ]);

      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["run-1", "run-2"]);
      expect(result[1].state).toBe(RunState.Done);
    });
  });

  describe("findById", () => {
    it("returns the mapped domain run when found", async () => {
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by newest first", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run exists for the issue", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findByIssueId("LIN-999");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when the only matching runs are terminal (simulated by prisma returning null)", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });

    it("maps a found active run to its domain shape", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ state: RunState.Implementing }),
      );

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result?.state).toBe(RunState.Implementing);
    });
  });

  describe("updateState", () => {
    it("updates the state field and returns the mapped domain run", async () => {
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ state: RunState.Planning }),
      );

      const result = await repo.updateState("run-1", RunState.Planning);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Planning" },
      });
      expect(result.state).toBe(RunState.Planning);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing title or description via an OR clause", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);

      await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
    });

    it("maps returned rows to domain runs", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ id: "run-5", linearIssueTitle: null }),
      ]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("run-5");
    });
  });

  describe("update", () => {
    it("passes the partial data straight through to prisma and maps the result", async () => {
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ branchName: "ai/new-branch", prNumber: 9 }),
      );

      const result = await repo.update("run-1", { branchName: "ai/new-branch", prNumber: 9 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/new-branch", prNumber: 9 },
      });
      expect(result.branchName).toBe("ai/new-branch");
      expect(result.prNumber).toBe(9);
    });

    it("supports updating with an empty partial object", async () => {
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      await repo.update("run-1", {});

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: {},
      });
    });
  });
});
