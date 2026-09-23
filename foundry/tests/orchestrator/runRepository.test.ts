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
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrisma() {
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
  let prisma: ReturnType<typeof buildPrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = buildPrisma();
    repo = new RunRepository(prisma as unknown as PrismaClient);
  });

  describe("create", () => {
    it("creates a run with optional fields provided, mapping state to Todo", async () => {
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test-repo",
        workingDirectory: "/tmp/repo",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
          repo: "test-repo",
          workingDirectory: "/tmp/repo",
          state: "Todo",
        },
      });
      expect(result.id).toBe("run-1");
      expect(result.state).toBe(RunState.Todo);
    });

    it("defaults optional fields to null when omitted", async () => {
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
      prisma.aiRun.create.mockResolvedValue(row);

      await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/repo",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
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
      expect(result[0]!.state).toBe(RunState.Todo);
    });

    it("builds an equality where clause for a single state", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an `in` where clause for multiple comma-separated states", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo, Planning ,Done");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats a filter of only separators/whitespace as no filter", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll(" , , ");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
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
      const result = await repo.findByIssueId("missing");
      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states and returns the mapped run", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Planning" }));
      const result = await repo.findActiveByIssueId("LIN-1");
      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: [RunState.Done, RunState.Failed] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Planning);
    });

    it("returns null when no active run exists", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const result = await repo.findActiveByIssueId("LIN-1");
      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run state and returns the mapped run", async () => {
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
    it("queries for runs missing title or description", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);
      const result = await repo.findRunsNeedingLinearBackfill();
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("passes through the partial update and returns the mapped run", async () => {
      prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "feature/x" }));
      const result = await repo.update("run-1", { branchName: "feature/x" });
      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feature/x" },
      });
      expect(result.branchName).toBe("feature/x");
    });
  });
});
