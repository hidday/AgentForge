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
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
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
    repo = new RunRepository(prisma as unknown as PrismaClient);
  });

  describe("create", () => {
    it("creates a run with defaulted optional fields and state Todo, returning the mapped domain object", async () => {
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "test-repo",
          workingDirectory: "/tmp",
          state: "Todo",
        },
      });
      expect(result.id).toBe("run-1");
      expect(result.state).toBe(RunState.Todo);
    });

    it("passes through provided optional fields", async () => {
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ID-1",
        linearIssueDescription: "d",
        linearIssueTitle: "t",
        linearIssueUrl: "u",
        repo: "test-repo",
        workingDirectory: "/tmp",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "ID-1",
          linearIssueDescription: "d",
          linearIssueTitle: "t",
          linearIssueUrl: "u",
        }),
      });
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when no filter is given", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
      const result = await repo.findAll();
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("queries with a single-state where clause when one state is given", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("queries with an 'in' where clause when a comma-separated multi-state filter is given", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo, Planning ,Implementing");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Implementing"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty-string filter (after trimming/filtering) as no filter", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll(",,");
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the mapped domain object when found", async () => {
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
    it("returns the mapped domain object when found", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ linearIssueId: "LIN-99" }));
      const result = await repo.findByIssueId("LIN-99");
      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-99" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-99");
    });

    it("returns null when not found", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const result = await repo.findByIssueId("missing");
      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("queries excluding terminal states and returns the mapped domain object when found", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ linearIssueId: "LIN-5" }));
      const result = await repo.findActiveByIssueId("LIN-5");
      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-5",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-5");
    });

    it("returns null when no active run is found", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const result = await repo.findActiveByIssueId("LIN-5");
      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state and returns the mapped domain object", async () => {
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
    it("queries for runs missing title or description and maps results", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);
      const result = await repo.findRunsNeedingLinearBackfill();
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
      expect(result[0].linearIssueTitle).toBeNull();
    });

    it("returns an empty array when nothing needs backfill", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);
      const result = await repo.findRunsNeedingLinearBackfill();
      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data through to prisma and returns the mapped domain object", async () => {
      prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "feature/x", prNumber: 7 }));
      const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 7 });
      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "feature/x", prNumber: 7 },
      });
      expect(result.branchName).toBe("feature/x");
      expect(result.prNumber).toBe(7);
    });
  });
});
