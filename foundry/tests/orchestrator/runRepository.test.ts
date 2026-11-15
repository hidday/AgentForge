import { describe, it, expect, vi } from "vitest";
import { RunRepository } from "../../src/orchestrator/runRepository.js";
import { RunState } from "../../src/domain/runState.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
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
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("RunRepository", () => {
  it("create() passes defaults and nullish-coalesced optional fields, maps row to domain", async () => {
    const prisma = makePrisma();
    prisma.aiRun.create.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma);

    const result = await repo.create({
      linearIssueId: "issue-1",
      repo: "org/repo",
      workingDirectory: "/tmp/repo",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: {
        linearIssueId: "issue-1",
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
        repo: "org/repo",
        workingDirectory: "/tmp/repo",
        state: "Todo",
      },
    });
    expect(result.id).toBe("run-1");
    expect(result.state).toBe(RunState.Todo);
  });

  it("create() forwards provided optional fields unchanged", async () => {
    const prisma = makePrisma();
    prisma.aiRun.create.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma);

    await repo.create({
      linearIssueId: "issue-1",
      linearIssueIdentifier: "ENG-9",
      linearIssueDescription: "d",
      linearIssueTitle: "t",
      linearIssueUrl: "https://x",
      repo: "org/repo",
      workingDirectory: "/tmp/repo",
    });

    expect(prisma.aiRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueIdentifier: "ENG-9",
        linearIssueDescription: "d",
        linearIssueTitle: "t",
        linearIssueUrl: "https://x",
      }),
    });
  });

  it("findAll() with no filter omits `where`", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([makeRow()]);
    const repo = new RunRepository(prisma);

    const result = await repo.findAll();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(1);
  });

  it("findAll() with a single state filters by exact state", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma);

    await repo.findAll("Planning");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: "Planning" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll() with comma-separated states filters with `in`, trimming whitespace and dropping empties", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([]);
    const repo = new RunRepository(prisma);

    await repo.findAll(" Planning ,, Implementing ");

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Planning", "Implementing"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findById() returns mapped domain object when found", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findUnique.mockResolvedValue(makeRow({ id: "run-2" }));
    const repo = new RunRepository(prisma);

    const result = await repo.findById("run-2");

    expect(prisma.aiRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-2" } });
    expect(result?.id).toBe("run-2");
  });

  it("findById() returns null when not found", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findUnique.mockResolvedValue(null);
    const repo = new RunRepository(prisma);

    const result = await repo.findById("missing");

    expect(result).toBeNull();
  });

  it("findByIssueId() orders by createdAt desc and returns null when absent", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findFirst.mockResolvedValue(null);
    const repo = new RunRepository(prisma);

    const result = await repo.findByIssueId("issue-9");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: { linearIssueId: "issue-9" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toBeNull();
  });

  it("findActiveByIssueId() excludes terminal states (Done, Failed)", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findFirst.mockResolvedValue(makeRow());
    const repo = new RunRepository(prisma);

    await repo.findActiveByIssueId("issue-1");

    expect(prisma.aiRun.findFirst).toHaveBeenCalledWith({
      where: {
        linearIssueId: "issue-1",
        state: { notIn: ["Done", "Failed"] },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("updateState() updates state and maps the returned row", async () => {
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

  it("findRunsNeedingLinearBackfill() queries for missing title OR description", async () => {
    const prisma = makePrisma();
    prisma.aiRun.findMany.mockResolvedValue([makeRow(), makeRow({ id: "run-3" })]);
    const repo = new RunRepository(prisma);

    const result = await repo.findRunsNeedingLinearBackfill();

    expect(prisma.aiRun.findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(result.map((r) => r.id)).toEqual(["run-1", "run-3"]);
  });

  it("update() forwards partial data and maps the returned row", async () => {
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
