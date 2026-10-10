import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

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
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
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
  describe("create", () => {
    it("creates a run with Todo state and passes through optional fields with nullish defaults", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });

      const repo = new RunRepository(prisma);
      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp",
      });

      expect(create).toHaveBeenCalledWith({
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

    it("passes through provided optional fields when given", async () => {
      const row = makeRow({
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://example.com",
      });
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });

      const repo = new RunRepository(prisma);
      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://example.com",
        repo: "test-repo",
        workingDirectory: "/tmp",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://example.com",
          repo: "test-repo",
          workingDirectory: "/tmp",
          state: "Todo",
        },
      });
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when stateFilter is omitted", async () => {
      const findMany = vi.fn().mockResolvedValue([makeRow()]);
      const prisma = makePrisma({ findMany });

      const repo = new RunRepository(prisma);
      const result = await repo.findAll();

      expect(findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(RunState.Todo);
    });

    it("filters by a single state when stateFilter has one value", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });

      const repo = new RunRepository(prisma);
      await repo.findAll("Done");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: "Done" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple states when stateFilter has several comma-separated values", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });

      const repo = new RunRepository(prisma);
      await repo.findAll(" Done , Failed ,, Todo ");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Done", "Failed", "Todo"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("leaves where undefined when stateFilter is entirely empty/whitespace", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });

      const repo = new RunRepository(prisma);
      await repo.findAll(" , ,");

      expect(findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      const findUnique = vi.fn().mockResolvedValue(makeRow());
      const prisma = makePrisma({ findUnique });

      const repo = new RunRepository(prisma);
      const result = await repo.findById("run-1");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
      expect(result?.id).toBe("run-1");
    });

    it("returns null when not found", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findUnique });

      const repo = new RunRepository(prisma);
      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("returns the mapped run when found", async () => {
      const findFirst = vi.fn().mockResolvedValue(makeRow());
      const prisma = makePrisma({ findFirst });

      const repo = new RunRepository(prisma);
      const result = await repo.findByIssueId("LIN-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when not found", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });

      const repo = new RunRepository(prisma);
      const result = await repo.findByIssueId("LIN-missing");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("queries excluding terminal states and returns the mapped run", async () => {
      const findFirst = vi.fn().mockResolvedValue(makeRow({ state: "Implementing" }));
      const prisma = makePrisma({ findFirst });

      const repo = new RunRepository(prisma);
      const result = await repo.findActiveByIssueId("LIN-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: [RunState.Done, RunState.Failed] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when no active run exists", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });

      const repo = new RunRepository(prisma);
      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run state and returns the mapped run", async () => {
      const update = vi.fn().mockResolvedValue(makeRow({ state: "Planning" }));
      const prisma = makePrisma({ update });

      const repo = new RunRepository(prisma);
      const result = await repo.updateState("run-1", RunState.Planning);

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Planning" },
      });
      expect(result.state).toBe(RunState.Planning);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries for runs missing title or description and maps results", async () => {
      const findMany = vi.fn().mockResolvedValue([makeRow(), makeRow({ id: "run-2" })]);
      const prisma = makePrisma({ findMany });

      const repo = new RunRepository(prisma);
      const result = await repo.findRunsNeedingLinearBackfill();

      expect(findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toEqual(["run-1", "run-2"]);
    });
  });

  describe("update", () => {
    it("updates arbitrary allowed fields and returns the mapped run", async () => {
      const update = vi.fn().mockResolvedValue(makeRow({ branchName: "ai/run-1", prNumber: 42 }));
      const prisma = makePrisma({ update });

      const repo = new RunRepository(prisma);
      const result = await repo.update("run-1", { branchName: "ai/run-1", prNumber: 42 });

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/run-1", prNumber: 42 },
      });
      expect(result.branchName).toBe("ai/run-1");
      expect(result.prNumber).toBe(42);
    });
  });
});
