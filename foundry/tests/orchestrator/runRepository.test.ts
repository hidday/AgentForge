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
    it("creates with provided optional fields and maps the row to a domain Run", async () => {
      const row = makeRow({
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
      });
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new RunRepository(prisma);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/x",
          repo: "test-repo",
          workingDirectory: "/tmp/work",
          state: "Todo",
        },
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("defaults missing optional fields to null", async () => {
      const row = makeRow();
      const create = vi.fn().mockResolvedValue(row);
      const prisma = makePrisma({ create });
      const repo = new RunRepository(prisma);

      await repo.create({
        linearIssueId: "LIN-1",
        repo: "test-repo",
        workingDirectory: "/tmp/work",
      });

      expect(create).toHaveBeenCalledWith({
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
    it("queries without a where clause when no stateFilter is given", async () => {
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

    it("builds an equality where clause for a single state", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: "Planning" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("builds an 'in' where clause for multiple comma-separated states, trimming whitespace", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findAll("Planning, PlanReview ,Done");

      expect(findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Planning", "PlanReview", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("leaves where undefined when stateFilter contains only blanks", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      await repo.findAll(" , ,");

      expect(findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row to a domain Run", async () => {
      const rows = [makeRow({ id: "a" }), makeRow({ id: "b", state: "Done" })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findAll();
      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
      expect(result[1].state).toBe(RunState.Done);
    });
  });

  describe("findById", () => {
    it("returns the mapped Run when found", async () => {
      const findUnique = vi.fn().mockResolvedValue(makeRow({ id: "run-42" }));
      const prisma = makePrisma({ findUnique });
      const repo = new RunRepository(prisma);

      const result = await repo.findById("run-42");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "run-42" } });
      expect(result?.id).toBe("run-42");
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
    it("returns the most recent mapped Run when found", async () => {
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

    it("returns null when no run exists for the issue", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      expect(await repo.findByIssueId("LIN-999")).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) via notIn", async () => {
      const findFirst = vi.fn().mockResolvedValue(makeRow({ state: "Planning" }));
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
      expect(result?.state).toBe(RunState.Planning);
    });

    it("returns null when there is no active run", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new RunRepository(prisma);

      expect(await repo.findActiveByIssueId("LIN-1")).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the state field and returns the mapped Run", async () => {
      const update = vi.fn().mockResolvedValue(makeRow({ state: "Done" }));
      const prisma = makePrisma({ update });
      const repo = new RunRepository(prisma);

      const result = await repo.updateState("run-1", RunState.Done);

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: RunState.Done },
      });
      expect(result.state).toBe(RunState.Done);
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries with an OR clause for missing title/description and maps rows", async () => {
      const rows = [makeRow({ id: "r1", linearIssueTitle: null })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = makePrisma({ findMany });
      const repo = new RunRepository(prisma);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("r1");
    });
  });

  describe("update", () => {
    it("passes partial data through to prisma and returns the mapped Run", async () => {
      const update = vi.fn().mockResolvedValue(makeRow({ branchName: "ai/run-1", prNumber: 7 }));
      const prisma = makePrisma({ update });
      const repo = new RunRepository(prisma);

      const result = await repo.update("run-1", { branchName: "ai/run-1", prNumber: 7 });

      expect(update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/run-1", prNumber: 7 },
      });
      expect(result.branchName).toBe("ai/run-1");
      expect(result.prNumber).toBe(7);
    });
  });
});
