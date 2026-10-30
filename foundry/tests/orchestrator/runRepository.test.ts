import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 0,
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
  describe("create", () => {
    it("creates a run with Todo state and null defaults for omitted optional fields", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.create.mockResolvedValue(makeRow());

      const repo = new RunRepository(prisma);
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
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("passes through optional fields when provided", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.create.mockResolvedValue(
        makeRow({
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
        }),
      );

      const repo = new RunRepository(prisma);
      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "org/repo",
        workingDirectory: "/tmp/work",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
        }),
      });
    });
  });

  describe("findAll", () => {
    it("queries without a state filter when none is given", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);

      const repo = new RunRepository(prisma);
      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });

    it("filters by a single state when one state is given", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);

      const repo = new RunRepository(prisma);
      await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple comma-separated states, trimming whitespace and dropping empties", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);

      const repo = new RunRepository(prisma);
      await repo.findAll("Planning, , Implementing ,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "Implementing"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats a filter string that is only whitespace/commas as no filter", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);

      const repo = new RunRepository(prisma);
      await repo.findAll(" , ,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row to the domain shape", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([
        makeRow({ id: "r1" }),
        makeRow({ id: "r2", state: "Done" }),
      ]);

      const repo = new RunRepository(prisma);
      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
      expect(result[1]!.state).toBe(RunState.Done);
    });
  });

  describe("findById", () => {
    it("returns the run mapped to domain shape when found", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findUnique.mockResolvedValue(makeRow());

      const repo = new RunRepository(prisma);
      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result).not.toBeNull();
      expect(result!.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findUnique.mockResolvedValue(null);

      const repo = new RunRepository(prisma);
      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the most recent run for the issue, mapped to domain shape", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow());

      const repo = new RunRepository(prisma);
      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result!.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run exists for the issue", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);

      const repo = new RunRepository(prisma);
      const result = await repo.findByIssueId("LIN-missing");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));

      const repo = new RunRepository(prisma);
      const result = await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result!.state).toBe(RunState.Implementing);
    });

    it("returns null when every run for the issue is terminal", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);

      const repo = new RunRepository(prisma);
      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state field and returns the mapped domain row", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "AIReview" }));

      const repo = new RunRepository(prisma);
      const result = await repo.updateState("run-1", RunState.AIReview);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "AIReview" },
      });
      expect(result.state).toBe(RunState.AIReview);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing a title or description snapshot", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([makeRow({ linearIssueTitle: null })]);

      const repo = new RunRepository(prisma);
      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when no runs need backfill", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);

      const repo = new RunRepository(prisma);
      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data through to prisma and maps the result", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.update.mockResolvedValue(
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
