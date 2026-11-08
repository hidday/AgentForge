import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
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
  } as unknown as PrismaClient;
}

describe("RunRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  describe("create", () => {
    it("defaults optional fields to null and sets state to Todo", async () => {
      const row = makeRow();
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new RunRepository(prisma);

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
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("passes through optional fields when provided", async () => {
      const row = makeRow({
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://example.com/LIN-1",
      });
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new RunRepository(prisma);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://example.com/LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://example.com/LIN-1",
        }),
      });
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when stateFilter is omitted", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("uses an equality filter for a single state", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("uses an 'in' filter for multiple comma-separated states, trimming whitespace", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning, Todo , Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "Todo", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats a filter string of only commas/whitespace as no filter", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      await repo.findAll(" , , ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row to the domain shape", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ id: "a" }),
        makeRow({ id: "b", state: "Done" }),
      ]);
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
      expect(result[1].state).toBe(RunState.Done);
    });
  });

  describe("findById", () => {
    it("returns the mapped domain object when found", async () => {
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma);

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new RunRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the most recent run for the issue when found", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run exists for the issue", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new RunRepository(prisma);

      const result = await repo.findByIssueId("LIN-missing");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("filters out terminal states (Done, Failed) and returns the mapped run", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ state: "Implementing" }),
      );
      const repo = new RunRepository(prisma);

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

    it("returns null when no active (non-terminal) run exists", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new RunRepository(prisma);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped domain object", async () => {
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ state: "Done" }),
      );
      const repo = new RunRepository(prisma);

      const result = await repo.updateState("run-1", RunState.Done);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Done" },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing title or description and maps them", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when nothing needs backfilling", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("forwards the partial data payload and returns the mapped domain object", async () => {
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ branchName: "ai/lin-1", prNumber: 42 }),
      );
      const repo = new RunRepository(prisma);

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
