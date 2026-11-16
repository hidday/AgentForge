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
    linearIssueUrl: "https://linear.app/x",
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work",
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
    it("creates a run with Todo state and maps nullable fields with ?? null", async () => {
      const row = makeRow();
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "acme/repo",
        workingDirectory: "/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "acme/repo",
          workingDirectory: "/work",
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
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "a description",
        linearIssueTitle: "a title",
        linearIssueUrl: "https://example.com",
        repo: "acme/repo",
        workingDirectory: "/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "a description",
          linearIssueTitle: "a title",
          linearIssueUrl: "https://example.com",
          repo: "acme/repo",
          workingDirectory: "/work",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries with no state filter when stateFilter is omitted", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("builds a single-state where clause for one state", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Todo");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an 'in' where clause for multiple comma-separated states, trimming whitespace", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Todo, Planning ,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty/whitespace-only filter string as no filter", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("  ,  ,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow({ id: "r2" }));

      const result = await repo.findById("r2");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "r2" } });
      expect(result?.id).toBe("r2");
    });

    it("returns null when not found", async () => {
      (prisma.aiRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the mapped run when found", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when not found", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findByIssueId("LIN-404");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) and returns the mapped run", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ state: "Implementing" }),
      );

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: [RunState.Done, RunState.Failed] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when no active run exists", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state and returns the mapped run", async () => {
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ state: "Done" }),
      );

      const result = await repo.updateState("run-1", RunState.Done);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: RunState.Done },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs with missing title or description via OR", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ linearIssueTitle: null }),
      ]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when nothing needs backfill", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("forwards the partial data and returns the mapped run", async () => {
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ branchName: "feature/x", prNumber: 42 }),
      );

      const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 42 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feature/x", prNumber: 42 },
      });
      expect(result.branchName).toBe("feature/x");
      expect(result.prNumber).toBe(42);
    });
  });
});
