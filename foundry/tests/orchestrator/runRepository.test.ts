import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function buildPrisma() {
  const prisma = {
    aiRun: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, prismaMock: prisma };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
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
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("RunRepository", () => {
  let prisma: PrismaClient;
  let prismaMock: ReturnType<typeof buildPrisma>["prismaMock"];
  let repo: RunRepository;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    prismaMock = built.prismaMock;
    repo = new RunRepository(prisma);
  });

  describe("create", () => {
    it("creates a run defaulted to Todo state, nulling out optional fields", async () => {
      const row = makeRow();
      prismaMock.aiRun.create.mockResolvedValue(row);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "acme/widgets",
        workingDirectory: "/tmp/run-1",
      });

      expect(prismaMock.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "acme/widgets",
          workingDirectory: "/tmp/run-1",
          state: "Todo",
        },
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("passes through optional linear fields when provided", async () => {
      prismaMock.aiRun.create.mockResolvedValue(makeRow({ linearIssueTitle: "Fix bug" }));

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "Fix bug",
        linearIssueUrl: "https://linear.app/x",
        repo: "acme/widgets",
        workingDirectory: "/tmp/run-1",
      });

      expect(prismaMock.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "ENG-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "Fix bug",
          linearIssueUrl: "https://linear.app/x",
        }),
      });
    });

    it("propagates errors from the underlying create call", async () => {
      prismaMock.aiRun.create.mockRejectedValue(new Error("write failed"));
      await expect(
        repo.create({ linearIssueId: "LIN-1", repo: "acme/widgets", workingDirectory: "/tmp" }),
      ).rejects.toThrow("write failed");
    });
  });

  describe("findAll", () => {
    it("queries without a where clause when no stateFilter is given", async () => {
      prismaMock.aiRun.findMany.mockResolvedValue([makeRow()]);
      await repo.findAll();
      expect(prismaMock.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by a single state when one state is given", async () => {
      prismaMock.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo");
      expect(prismaMock.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters with an 'in' clause when multiple comma-separated states are given", async () => {
      prismaMock.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo, Planning, Done");
      expect(prismaMock.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("ignores empty segments produced by stray commas or whitespace", async () => {
      prismaMock.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll("Todo,, ,Planning");
      expect(prismaMock.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Planning"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats an all-empty filter string as no filter", async () => {
      prismaMock.aiRun.findMany.mockResolvedValue([]);
      await repo.findAll(" , , ");
      expect(prismaMock.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("maps every returned row to the Run domain shape", async () => {
      const rows = [makeRow({ id: "r1" }), makeRow({ id: "r2", state: "Done" })];
      prismaMock.aiRun.findMany.mockResolvedValue(rows);
      const result = await repo.findAll();
      expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
      expect(result[1].state).toBe(RunState.Done);
    });
  });

  describe("findById", () => {
    it("returns the mapped run when found", async () => {
      prismaMock.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-x" }));
      const result = await repo.findById("run-x");
      expect(prismaMock.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-x" } });
      expect(result?.id).toBe("run-x");
    });

    it("returns null when not found", async () => {
      prismaMock.aiRun.findUnique.mockResolvedValue(null);
      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByIssueId", () => {
    it("queries by linearIssueId ordered by createdAt desc", async () => {
      prismaMock.aiRun.findFirst.mockResolvedValue(makeRow());
      const result = await repo.findByIssueId("LIN-1");
      expect(prismaMock.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run exists for the issue", async () => {
      prismaMock.aiRun.findFirst.mockResolvedValue(null);
      const result = await repo.findByIssueId("LIN-404");
      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) via notIn", async () => {
      prismaMock.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));
      const result = await repo.findActiveByIssueId("LIN-1");
      expect(prismaMock.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when only terminal runs exist (mocked as no active match)", async () => {
      prismaMock.aiRun.findFirst.mockResolvedValue(null);
      const result = await repo.findActiveByIssueId("LIN-1");
      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped row", async () => {
      prismaMock.aiRun.update.mockResolvedValue(makeRow({ state: "Planning" }));
      const result = await repo.updateState("run-1", RunState.Planning);
      expect(prismaMock.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: RunState.Planning },
      });
      expect(result.state).toBe(RunState.Planning);
    });

    it("propagates errors from the underlying update call", async () => {
      prismaMock.aiRun.update.mockRejectedValue(new Error("not found"));
      await expect(repo.updateState("missing", RunState.Planning)).rejects.toThrow("not found");
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries for runs missing title or description", async () => {
      const rows = [makeRow({ id: "r1", linearIssueTitle: null })];
      prismaMock.aiRun.findMany.mockResolvedValue(rows);
      const result = await repo.findRunsNeedingLinearBackfill();
      expect(prismaMock.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when nothing needs backfill", async () => {
      prismaMock.aiRun.findMany.mockResolvedValue([]);
      const result = await repo.findRunsNeedingLinearBackfill();
      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("passes the partial data through and returns the mapped row", async () => {
      prismaMock.aiRun.update.mockResolvedValue(makeRow({ branchName: "ai/run-1", prNumber: 42 }));

      const result = await repo.update("run-1", { branchName: "ai/run-1", prNumber: 42 });

      expect(prismaMock.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/run-1", prNumber: 42 },
      });
      expect(result.branchName).toBe("ai/run-1");
      expect(result.prNumber).toBe(42);
    });

    it("propagates errors from the underlying update call", async () => {
      prismaMock.aiRun.update.mockRejectedValue(new Error("constraint violation"));
      await expect(repo.update("run-1", { prNumber: 1 })).rejects.toThrow("constraint violation");
    });
  });
});
