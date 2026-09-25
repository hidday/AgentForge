import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

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

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
    repo: "test/repo",
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

describe("RunRepository.create", () => {
  it("creates a run with state Todo and normalizes optional fields to null when omitted", async () => {
    const prisma = buildPrisma();
    const row = makeRow({
      linearIssueIdentifier: null,
      linearIssueDescription: null,
      linearIssueTitle: null,
      linearIssueUrl: null,
    });
    prisma.aiRun.create.mockResolvedValue(row);

    const repo = new RunRepository(prisma as never);
    const result = await repo.create({
      linearIssueId: "LIN-1",
      repo: "test/repo",
      workingDirectory: "/tmp/run-1",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: {
        linearIssueId: "LIN-1",
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
        repo: "test/repo",
        workingDirectory: "/tmp/run-1",
        state: "Todo",
      },
    });
    expect(result.state).toBe("Todo");
    expect(result.linearIssueIdentifier).toBeNull();
  });

  it("passes through provided optional Linear fields instead of defaulting to null", async () => {
    const prisma = buildPrisma();
    const row = makeRow();
    prisma.aiRun.create.mockResolvedValue(row);

    const repo = new RunRepository(prisma as never);
    await repo.create({
      linearIssueId: "LIN-1",
      linearIssueIdentifier: "ENG-1",
      linearIssueDescription: "desc",
      linearIssueTitle: "title",
      linearIssueUrl: "https://linear.app/x",
      repo: "test/repo",
      workingDirectory: "/tmp/run-1",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: {
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://linear.app/x",
        repo: "test/repo",
        workingDirectory: "/tmp/run-1",
        state: "Todo",
      },
    });
  });
});

describe("RunRepository.findAll", () => {
  it("queries with no where clause and orders by createdAt desc when stateFilter is omitted", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findMany.mockResolvedValue([makeRow()]);

    const repo = new RunRepository(prisma as never);
    const result = await repo.findAll();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(1);
    expect(result[0].state).toBe("Todo");
  });

  it("builds an equality where clause for a single state", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);

    const repo = new RunRepository(prisma as never);
    await repo.findAll("Done");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: "Done" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("builds an `in` where clause for multiple comma-separated states and trims whitespace", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);

    const repo = new RunRepository(prisma as never);
    await repo.findAll(" Done , Failed ,Todo");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Done", "Failed", "Todo"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("treats an empty-string stateFilter as no filter (falsy, where stays undefined)", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);

    const repo = new RunRepository(prisma as never);
    await repo.findAll("");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  it("filters out empty segments produced by stray commas, leaving where undefined if nothing remains", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);

    const repo = new RunRepository(prisma as never);
    await repo.findAll(" , , ");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  it("maps every returned row to the domain shape", async () => {
    const prisma = buildPrisma();
    const rows = [makeRow({ id: "run-1" }), makeRow({ id: "run-2", state: "Done" })];
    prisma.aiRun.findMany.mockResolvedValue(rows);

    const repo = new RunRepository(prisma as never);
    const result = await repo.findAll();

    expect(result.map((r) => r.id)).toEqual(["run-1", "run-2"]);
    expect(result[1].state).toBe("Done");
  });
});

describe("RunRepository.findById", () => {
  it("returns the mapped run when found", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findUnique.mockResolvedValue(makeRow());

    const repo = new RunRepository(prisma as never);
    const result = await repo.findById("run-1");

    expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
    expect(result?.id).toBe("run-1");
  });

  it("returns null when not found", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findUnique.mockResolvedValue(null);

    const repo = new RunRepository(prisma as never);
    const result = await repo.findById("missing");

    expect(result).toBeNull();
  });
});

describe("RunRepository.findByIssueId", () => {
  it("queries by linearIssueId ordered by createdAt desc and returns the mapped run", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow());

    const repo = new RunRepository(prisma as never);
    const result = await repo.findByIssueId("LIN-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "LIN-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result?.linearIssueId).toBe("LIN-1");
  });

  it("returns null when no run matches the issue id", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findFirst.mockResolvedValue(null);

    const repo = new RunRepository(prisma as never);
    const result = await repo.findByIssueId("LIN-missing");

    expect(result).toBeNull();
  });
});

describe("RunRepository.findActiveByIssueId", () => {
  it("queries excluding terminal states (Done, Failed) ordered by createdAt desc", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));

    const repo = new RunRepository(prisma as never);
    const result = await repo.findActiveByIssueId("LIN-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "LIN-1",
        state: { notIn: [RunState.Done, RunState.Failed] },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(result?.state).toBe("Implementing");
  });

  it("returns null when no active run exists for the issue", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findFirst.mockResolvedValue(null);

    const repo = new RunRepository(prisma as never);
    const result = await repo.findActiveByIssueId("LIN-1");

    expect(result).toBeNull();
  });
});

describe("RunRepository.updateState", () => {
  it("updates the state field and returns the mapped run", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Done" }));

    const repo = new RunRepository(prisma as never);
    const result = await repo.updateState("run-1", RunState.Done);

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: RunState.Done },
    });
    expect(result.state).toBe("Done");
  });
});

describe("RunRepository.findRunsNeedingLinearBackfill", () => {
  it("queries with an OR on missing title/description and maps all rows", async () => {
    const prisma = buildPrisma();
    const rows = [
      makeRow({ id: "run-a", linearIssueTitle: null }),
      makeRow({ id: "run-b", linearIssueDescription: null }),
    ];
    prisma.aiRun.findMany.mockResolvedValue(rows);

    const repo = new RunRepository(prisma as never);
    const result = await repo.findRunsNeedingLinearBackfill();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
      },
    });
    expect(result.map((r) => r.id)).toEqual(["run-a", "run-b"]);
  });

  it("returns an empty array when nothing needs backfill", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);

    const repo = new RunRepository(prisma as never);
    const result = await repo.findRunsNeedingLinearBackfill();

    expect(result).toEqual([]);
  });
});

describe("RunRepository.update", () => {
  it("passes the partial data through as-is and returns the mapped run", async () => {
    const prisma = buildPrisma();
    prisma.aiRun.update.mockResolvedValue(
      makeRow({ branchName: "ai/run-1", prNumber: 42, planVersion: 2 }),
    );

    const repo = new RunRepository(prisma as never);
    const result = await repo.update("run-1", {
      branchName: "ai/run-1",
      prNumber: 42,
      planVersion: 2,
    });

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { branchName: "ai/run-1", prNumber: 42, planVersion: 2 },
    });
    expect(result.branchName).toBe("ai/run-1");
    expect(result.prNumber).toBe(42);
    expect(result.planVersion).toBe(2);
  });
});
