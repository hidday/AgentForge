import { describe, it, expect, vi } from "vitest";
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
    workingDirectory: "/tmp/run-1",
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
  };
}

describe("RunRepository", () => {
  describe("create", () => {
    it("creates with defaults for omitted optional fields and state Todo", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      prisma.aiRun.create.mockResolvedValue(row);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "org/repo",
        workingDirectory: "/tmp/run-1",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "org/repo",
          workingDirectory: "/tmp/run-1",
          state: "Todo",
        },
      });
      expect(result.id).toBe("run-1");
      expect(result.state).toBe(RunState.Todo);
    });

    it("passes through optional Linear metadata when provided", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.create.mockResolvedValue(makeRow({ linearIssueIdentifier: "LIN-1" }));
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "org/repo",
        workingDirectory: "/tmp/run-1",
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
  });

  describe("findAll", () => {
    it("queries with no where clause when no filter is given", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });

    it("filters by a single state", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.findAll("Planning");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple comma-separated states, trimming whitespace", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.findAll("Planning, PlanReview ,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "PlanReview", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("leaves where undefined when the filter contains only separators", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      await repo.findAll(",,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findUnique.mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findById("run-1");

      expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findUnique.mockResolvedValue(null);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the most recent run for the issue", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow());
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run exists for the issue", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      expect(await repo.findByIssueId("LIN-99")).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Planning" }));
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Planning);
    });

    it("returns null when there is no active run", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findFirst.mockResolvedValue(null);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      expect(await repo.findActiveByIssueId("LIN-1")).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state field and returns the mapped run", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Done" }));
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.updateState("run-1", RunState.Done);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Done" },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing title or description", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.findMany.mockResolvedValue([makeRow(), makeRow({ id: "run-2" })]);
      const repo = new RunRepository(prisma as unknown as PrismaClient);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("passes partial data through to prisma and returns the mapped run", async () => {
      const prisma = makePrismaMock();
      prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/lin-1", prNumber: 42 }));
      const repo = new RunRepository(prisma as unknown as PrismaClient);

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
