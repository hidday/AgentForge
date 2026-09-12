import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x/issue/ENG-1",
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work/run-1",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  const aiRun = {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
  return { aiRun } as unknown as PrismaClient & { aiRun: typeof aiRun };
}

describe("RunRepository.create", () => {
  it("creates a run in Todo state and maps nullable fields, translating state to RunState", async () => {
    const prisma = makePrisma();
    prisma.aiRun.create.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma);

    const result = await repo.create({
      linearIssueId: "issue-1",
      repo: "acme/repo",
      workingDirectory: "/work/run-1",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: {
        linearIssueId: "issue-1",
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
        repo: "acme/repo",
        workingDirectory: "/work/run-1",
        state: "Todo",
      },
    });
    expect(result.state).toBe(RunState.Todo);
    expect(result.id).toBe("run-1");
  });

  it("passes through optional linear fields when provided", async () => {
    const prisma = makePrisma();
    prisma.aiRun.create.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma);

    await repo.create({
      linearIssueId: "issue-1",
      linearIssueIdentifier: "ENG-1",
      linearIssueDescription: "desc",
      linearIssueTitle: "title",
      linearIssueUrl: "https://linear.app/x/issue/ENG-1",
      repo: "acme/repo",
      workingDirectory: "/work/run-1",
    });

    const call = prisma.aiRun.create.mock.calls[0][0];
    expect(call.data.linearIssueIdentifier).toBe("ENG-1");
    expect(call.data.linearIssueDescription).toBe("desc");
    expect(call.data.linearIssueTitle).toBe("title");
    expect(call.data.linearIssueUrl).toBe("https://linear.app/x/issue/ENG-1");
  });
});

describe("RunRepository.findAll", () => {
  it("queries without a where clause when no stateFilter is given", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
    const repo = new RunRepository(prisma);

    const result = await repo.findAll();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(1);
    expect(result[0].state).toBe(RunState.Todo);
  });

  it("builds a single-state where clause for one state", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma);

    await repo.findAll("Implementing");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: "Implementing" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("builds an `in` where clause for a comma-separated list, trimming whitespace and dropping empties", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma);

    await repo.findAll(" Todo, Implementing ,,Done");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Todo", "Implementing", "Done"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("treats an all-empty/whitespace filter as no filter", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma);

    await repo.findAll(" , ,");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("RunRepository.findById", () => {
  it("returns the mapped run when found", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findUnique.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma);

    const result = await repo.findById("run-1");

    expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
    expect(result?.id).toBe("run-1");
  });

  it("returns null when not found", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findUnique.mockResolvedValue(null);
    const repo = new RunRepository(prisma);

    const result = await repo.findById("missing");

    expect(result).toBeNull();
  });
});

describe("RunRepository.findByIssueId", () => {
  it("returns the most recent run for the issue", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma);

    const result = await repo.findByIssueId("issue-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "issue-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result?.linearIssueId).toBe("issue-1");
  });

  it("returns null when no run exists for the issue", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findFirst.mockResolvedValue(null);
    const repo = new RunRepository(prisma);

    const result = await repo.findByIssueId("missing-issue");

    expect(result).toBeNull();
  });
});

describe("RunRepository.findActiveByIssueId", () => {
  it("excludes terminal states (Done, Failed)", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow({ state: "Implementing" }));
    const repo = new RunRepository(prisma);

    const result = await repo.findActiveByIssueId("issue-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "issue-1",
        state: { notIn: ["Done", "Failed"] },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(result?.state).toBe(RunState.Implementing);
  });

  it("returns null when no active run exists", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findFirst.mockResolvedValue(null);
    const repo = new RunRepository(prisma);

    const result = await repo.findActiveByIssueId("issue-1");

    expect(result).toBeNull();
  });
});

describe("RunRepository.updateState", () => {
  it("updates the state field and maps the result", async () => {
    const prisma = makePrisma();
    prisma.aiRun.update.mockResolvedValue(makeRow({ state: "Done" }));
    const repo = new RunRepository(prisma);

    const result = await repo.updateState("run-1", RunState.Done);

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: "Done" },
    });
    expect(result.state).toBe(RunState.Done);
  });
});

describe("RunRepository.findRunsNeedingLinearBackfill", () => {
  it("queries runs missing title or description via OR", async () => {
    const prisma = makePrisma();
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

  it("returns an empty array when nothing needs backfill", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma);

    const result = await repo.findRunsNeedingLinearBackfill();

    expect(result).toEqual([]);
  });
});

describe("RunRepository.update", () => {
  it("passes partial data straight through to prisma and maps the result", async () => {
    const prisma = makePrisma();
    prisma.aiRun.update.mockResolvedValue(makeRow({ branchName: "feature/x", prNumber: 42 }));
    const repo = new RunRepository(prisma);

    const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 42 });

    expect(prisma.aiRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { branchName: "feature/x", prNumber: 42 },
    });
    expect(result.branchName).toBe("feature/x");
    expect(result.prNumber).toBe(42);
  });
});
