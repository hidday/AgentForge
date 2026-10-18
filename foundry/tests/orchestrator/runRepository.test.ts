import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
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
    workingDirectory: "/tmp/acme-widgets",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
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

type FakePrisma = ReturnType<typeof makePrisma>;

describe("RunRepository", () => {
  let prisma: FakePrisma;
  let repo: RunRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new RunRepository(prisma as unknown as PrismaClient);
  });

  describe("create", () => {
    it("creates a run in the Todo state with null defaults for optional fields", async () => {
      const row = makeRow({
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
      });
      prisma.aiRun.create.mockResolvedValue(row);

      const result = await repo.create({
        linearIssueId: "LIN-1",
        repo: "acme/widgets",
        workingDirectory: "/tmp/acme-widgets",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: {
          linearIssueId: "LIN-1",
          linearIssueIdentifier: null,
          linearIssueDescription: null,
          linearIssueTitle: null,
          linearIssueUrl: null,
          repo: "acme/widgets",
          workingDirectory: "/tmp/acme-widgets",
          state: "Todo",
        },
      });
      expect(result.state).toBe(RunState.Todo);
      expect(result.id).toBe("run-1");
    });

    it("passes through optional Linear metadata when provided", async () => {
      prisma.aiRun.create.mockResolvedValue(makeRow());

      await repo.create({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/team/issue/LIN-1",
        repo: "acme/widgets",
        workingDirectory: "/tmp/acme-widgets",
      });

      expect(prisma.aiRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          linearIssueIdentifier: "LIN-1",
          linearIssueDescription: "desc",
          linearIssueTitle: "title",
          linearIssueUrl: "https://linear.app/team/issue/LIN-1",
        }),
      });
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiRun.create.mockRejectedValue(new Error("insert failed"));

      await expect(
        repo.create({ linearIssueId: "LIN-1", repo: "acme/widgets", workingDirectory: "/tmp" }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("findAll", () => {
    it("queries with no state filter when stateFilter is omitted", async () => {
      prisma.aiRun.findMany.mockResolvedValue([makeRow()]);

      const result = await repo.findAll();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });

    it("filters by a single state", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("Todo");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: "Todo" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by multiple comma-separated states, trimming whitespace", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("Todo, Failed , Done");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Failed", "Done"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("ignores empty entries produced by stray commas", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll("Todo,,Failed");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["Todo", "Failed"] } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("treats a filter that is only commas/whitespace as no filter", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      await repo.findAll(" , , ");

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns an empty array when there are no matching runs", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      const result = await repo.findAll("Done");

      expect(result).toEqual([]);
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiRun.findMany.mockRejectedValue(new Error("query failed"));

      await expect(repo.findAll()).rejects.toThrow("query failed");
    });
  });

  describe("findById", () => {
    it("returns the run when found", async () => {
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
    it("returns the newest run for the issue", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow());

      const result = await repo.findByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: { linearIssueId: "LIN-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.linearIssueId).toBe("LIN-1");
    });

    it("returns null when no run exists for the issue", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);

      const result = await repo.findByIssueId("LIN-999");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByIssueId", () => {
    it("excludes terminal states (Done, Failed) from the search", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
        where: {
          linearIssueId: "LIN-1",
          state: { notIn: ["Done", "Failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.state).toBe(RunState.Implementing);
    });

    it("returns null when the only runs for the issue are terminal", async () => {
      prisma.aiRun.findFirst.mockResolvedValue(null);

      const result = await repo.findActiveByIssueId("LIN-1");

      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    it("updates the run's state and returns the mapped run", async () => {
      prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Implementing" }));

      const result = await repo.updateState("run-1", RunState.Implementing);

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { state: "Implementing" },
      });
      expect(result.state).toBe(RunState.Implementing);
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiRun.update.mockRejectedValue(new Error("record not found"));

      await expect(repo.updateState("missing", RunState.Failed)).rejects.toThrow(
        "record not found",
      );
    });
  });

  describe("findRunsNeedingLinearBackfill", () => {
    it("queries runs missing a title or a description", async () => {
      const rows = [makeRow({ linearIssueTitle: null }), makeRow({ linearIssueDescription: null })];
      prisma.aiRun.findMany.mockResolvedValue(rows);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
        },
      });
      expect(result).toHaveLength(2);
    });

    it("returns an empty array when every run already has title and description", async () => {
      prisma.aiRun.findMany.mockResolvedValue([]);

      const result = await repo.findRunsNeedingLinearBackfill();

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("applies a partial update and returns the mapped run", async () => {
      prisma.aiRun.update.mockResolvedValue(
        makeRow({ branchName: "ai/lin-1-fix", prNumber: 42 }),
      );

      const result = await repo.update("run-1", { branchName: "ai/lin-1-fix", prNumber: 42 });

      expect(prisma.aiRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { branchName: "ai/lin-1-fix", prNumber: 42 },
      });
      expect(result.branchName).toBe("ai/lin-1-fix");
      expect(result.prNumber).toBe(42);
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.aiRun.update.mockRejectedValue(new Error("update failed"));

      await expect(repo.update("run-1", { prNumber: 1 })).rejects.toThrow("update failed");
    });
  });
});
