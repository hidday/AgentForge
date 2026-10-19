import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeMockPrisma() {
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

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "iss-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("RunRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new RunRepository(prisma);
  });

  describe("create", () => {
    it("creates a run in the Todo state with optional fields defaulted to null", async () => {
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      const result = await repo.create({
        linearIssueId: "iss-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "acme/repo",
        workingDirectory: "/tmp/run-1",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "iss-1",
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
          repo: "acme/repo",
          workingDirectory: "/tmp/run-1",
          state: "Todo",
        },
      });
      expect(result.state).toBe(RunState.Todo);
    });

    it("defaults optional linear fields to null when omitted", async () => {
      (prisma.aiRun.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      await repo.create({
        linearIssueId: "iss-1",
        repo: "acme/repo",
        workingDirectory: "/tmp/run-1",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "iss-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "acme/repo",
          workingDirectory: "/tmp/run-1",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries without a where filter when no stateFilter is given", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });

    it("filters by a single state when stateFilter has one value", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Todo");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters with an `in` clause when stateFilter has multiple comma-separated values", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll("Todo, Planning ,Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("ignores a stateFilter that is only whitespace/commas and queries without a filter", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.findAll(" , ,");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
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
    it("returns the most recent run for the issue when found", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const result = await repo.findByIssueId("iss-1");
      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "iss-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("iss-1");
    });

    it("returns null when no run exists for the issue", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await repo.findByIssueId("iss-none");
      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the query", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const result = await repo.findActiveByIssueId("iss-1");
      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "iss-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).not.toBeNull();
    });

    it("returns null when there is no active run for the issue", async () => {
      (prisma.aiRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await repo.findActiveByIssueId("iss-1");
      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped run", async () => {
      (prisma.aiRun.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ state: "Implementing" }),
      );

      const result = await repo.updateState("run-1", RunState.Implementing);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Implementing" },
      });
      expect(result.state).toBe(RunState.Implementing);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries for runs missing a title or description", async () => {
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

    it("returns an empty array when every run already has title and description", async () => {
      (prisma.aiRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await repo.findRunsNeedingLinearBackfill();
      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes partial data straight through to prisma and returns the mapped run", async () => {
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
