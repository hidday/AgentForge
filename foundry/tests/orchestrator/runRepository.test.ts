import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "test-repo",
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
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function buildPrisma() {
  const aiRun = {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  };
  const prisma = { aiRun } as unknown as PrismaClient;
  return { prisma, aiRun };
}

describe("RunRepository", () => {
  let prisma: PrismaClient;
  let aiRun: ReturnType<typeof buildPrisma>["aiRun"];
  let repo: RunRepository;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    aiRun = built.aiRun;
    repo = new RunRepository(prisma);
  });

  describe("create", () => {
    it("passes required fields and defaults optional fields to null, with state Todo", async () => {
      aiRun.create.mockResolvedValue(makeRow());

      await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(aiRun.create).toHaveBeenCalledWith({
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
    });

    it("passes through optional fields when provided", async () => {
      aiRun.create.mockResolvedValue(makeRow());

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/issue/ENG-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/issue/ENG-1",
          repo: "test-repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
    });

    it("maps the created row to a domain Run with state cast to RunState", async () => {
      aiRun.create.mockResolvedValue(makeRow({ state: "Todo" }));

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(result.id).toBe("run-1");
      expect(result.state).toBe(RunState.Todo);
      expect(result.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("findAll", () => {
    it("queries with no where clause when stateFilter is undefined", async () => {
      aiRun.findMany.mockResolvedValue([]);

      await repo.findAll();

      expect(aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an equality where clause for a single state", async () => {
      aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("Planning");

      expect(aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an `in` where clause for multiple comma-separated states, trimming whitespace", async () => {
      aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("Planning, PlanReview ,Done");

      expect(aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "PlanReview", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an empty/blank stateFilter as no filter", async () => {
      aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("   ");

      expect(aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps all returned rows to domain Runs", async () => {
      aiRun.findMany.mockResolvedValue([makeRow({ id: "a" }), makeRow({ id: "b" })]);

      const result = await repo.findAll();

      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when there are no matching rows", async () => {
      aiRun.findMany.mockResolvedValue([]);

      const result = await repo.findAll("Done");

      expect(result).toEqual([]);
    });
  });

  describe("findById", () => {
    it("queries by id and maps the row when found", async () => {
      aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-42" }));

      const result = await repo.findById("run-42");

      expect(aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
      expect(result?.id).toBe("run-42");
    });

    it("returns null when the row is not found", async () => {
      aiRun.findUnique.mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by createdAt desc", async () => {
      aiRun.findFirst.mockResolvedValue(makeRow());

      await repo.findByIssueId("LIN-1");

      expect(aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when no run matches the issue id", async () => {
      aiRun.findFirst.mockResolvedValue(null);

      const result = await repo.findByIssueId("LIN-999");

      expect(result).toBeNull();
    });

    it("maps the found row to a domain Run", async () => {
      aiRun.findFirst.mockResolvedValue(makeRow({ id: "run-found" }));

      const result = await repo.findByIssueId("LIN-1");

      expect(result?.id).toBe("run-found");
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) via notIn", async () => {
      aiRun.findFirst.mockResolvedValue(null);

      await repo.findActiveByIssueId("LIN-1");

      expect(aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when no active run exists for the issue", async () => {
      aiRun.findFirst.mockResolvedValue(null);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });

    it("maps the active row to a domain Run when found", async () => {
      aiRun.findFirst.mockResolvedValue(makeRow({ id: "active-run", state: "Implementing" }));

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result?.id).toBe("active-run");
      expect(result?.state).toBe(RunState.Implementing);
    });
  });

  describe("updateState", () => {
    it("updates by id with the given state", async () => {
      aiRun.update.mockResolvedValue(makeRow({ state: "PlanReview" }));

      await repo.updateState("run-1", RunState.PlanReview);

      expect(aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "PlanReview" },
      });
    });

    it("maps the updated row to a domain Run", async () => {
      aiRun.update.mockResolvedValue(makeRow({ id: "run-1", state: "Done" }));

      const result = await repo.updateState("run-1", RunState.Done);

      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries with an OR of null title / null description", async () => {
      aiRun.findMany.mockResolvedValue([]);

      await repo.findRunsNeedingLinearBackfill();

      expect(aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
    });

    it("maps all returned rows to domain Runs", async () => {
      aiRun.findMany.mockResolvedValue([
        makeRow({ id: "r1", linearIssueTitle: null }),
        makeRow({ id: "r2", linearIssueDescription: null }),
      ]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
    });

    it("returns an empty array when nothing needs backfill", async () => {
      aiRun.findMany.mockResolvedValue([]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("updates by id with the provided partial data as-is", async () => {
      aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/run-1" }));

      await repo.update("run-1", { branchName: "ai/run-1", prNumber: 42 });

      expect(aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/run-1", prNumber: 42 },
      });
    });

    it("supports updating with an empty data object", async () => {
      aiRun.update.mockResolvedValue(makeRow());

      await repo.update("run-1", {});

      expect(aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: {},
      });
    });

    it("maps the updated row to a domain Run", async () => {
      aiRun.update.mockResolvedValue(makeRow({ id: "run-1", latestArtifactVersion: 3 }));

      const result = await repo.update("run-1", { latestArtifactVersion: 3 });

      expect(result.latestArtifactVersion).toBe(3);
    });
  });
});
