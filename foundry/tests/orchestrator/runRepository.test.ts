import { describe, it, expect, vi } from "vitest";
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrisma(methods: Record<string, unknown> = {}) {
  return {
    aiRun: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      ...methods,
    },
  } as unknown as import("../../src/generated/prisma/client.js").PrismaClient;
}

describe("RunRepository", () => {
  it("creates a run, defaulting optional fields to null and state to Todo", async () => {
    const create = vi.fn().mockResolvedValue(makeRow());
    const prisma = makePrisma({ create });
    const repo = new RunRepository(prisma);

    const result = await repo.create({
      linearIssueId: "LIN-1",
      repo: "test/repo",
      workingDirectory: "/tmp/work",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        linearIssueId: "LIN-1",
        linearIssueIdentifier: null,
        linearIssueDescription: null,
        linearIssueTitle: null,
        linearIssueUrl: null,
        repo: "test/repo",
        workingDirectory: "/tmp/work",
        state: "Todo",
      },
    });
    expect(result.state).toBe("Todo");
  });

  it("creates a run passing through all optional fields when provided", async () => {
    const create = vi.fn().mockResolvedValue(makeRow());
    const prisma = makePrisma({ create });
    const repo = new RunRepository(prisma);

    await repo.create({
      linearIssueId: "LIN-1",
      linearIssueIdentifier: "ENG-1",
      linearIssueDescription: "desc",
      linearIssueTitle: "title",
      linearIssueUrl: "https://example.com",
      repo: "test/repo",
      workingDirectory: "/tmp/work",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: "desc",
        linearIssueTitle: "title",
        linearIssueUrl: "https://example.com",
      }),
    });
  });

  it("findAll with no filter queries without a where clause", async () => {
    const findMany = vi.fn().mockResolvedValue([makeRow()]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    await repo.findAll();

    expect(findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll with a single state filters by that exact state", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    await repo.findAll("Todo");

    expect(findMany).toHaveBeenCalledWith({
      where: { state: "Todo" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll with multiple comma-separated states filters with an `in` clause, trimming whitespace and dropping empties", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    await repo.findAll("Todo, Planning ,,Done");

    expect(findMany).toHaveBeenCalledWith({
      where: { state: { in: ["Todo", "Planning", "Done"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findAll with a filter that is only commas/whitespace falls back to no where clause", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    await repo.findAll(" , , ");

    expect(findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  it("findById returns the mapped run when found", async () => {
    const findUnique = vi.fn().mockResolvedValue(makeRow({ id: "run-9" }));
    const prisma = makePrisma({ findUnique });
    const repo = new RunRepository(prisma);

    const result = await repo.findById("run-9");

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "run-9" } });
    expect(result?.id).toBe("run-9");
  });

  it("findById returns null when not found", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findUnique });
    const repo = new RunRepository(prisma);

    expect(await repo.findById("missing")).toBeNull();
  });

  it("findByIssueId returns the most recent run for an issue", async () => {
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

  it("findByIssueId returns null when no run exists for the issue", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new RunRepository(prisma);

    expect(await repo.findByIssueId("LIN-missing")).toBeNull();
  });

  it("findActiveByIssueId excludes terminal states (Done, Failed)", async () => {
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
    expect(result?.state).toBe("Implementing");
  });

  it("findActiveByIssueId returns null when there is no active run", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new RunRepository(prisma);

    expect(await repo.findActiveByIssueId("LIN-1")).toBeNull();
  });

  it("updateState persists the new state and returns the mapped run", async () => {
    const update = vi.fn().mockResolvedValue(makeRow({ state: "Done" }));
    const prisma = makePrisma({ update });
    const repo = new RunRepository(prisma);

    const result = await repo.updateState("run-1", RunState.Done);

    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: RunState.Done },
    });
    expect(result.state).toBe("Done");
  });

  it("findRunsNeedingLinearBackfill queries runs missing a title or description", async () => {
    const findMany = vi.fn().mockResolvedValue([makeRow(), makeRow({ id: "run-2" })]);
    const prisma = makePrisma({ findMany });
    const repo = new RunRepository(prisma);

    const result = await repo.findRunsNeedingLinearBackfill();

    expect(findMany).toHaveBeenCalledWith({
      where: { OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }] },
    });
    expect(result).toHaveLength(2);
  });

  it("update persists a partial patch and returns the mapped run", async () => {
    const update = vi.fn().mockResolvedValue(makeRow({ branchName: "feature/x", prNumber: 42 }));
    const prisma = makePrisma({ update });
    const repo = new RunRepository(prisma);

    const result = await repo.update("run-1", { branchName: "feature/x", prNumber: 42 });

    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { branchName: "feature/x", prNumber: 42 },
    });
    expect(result.branchName).toBe("feature/x");
    expect(result.prNumber).toBe(42);
  });
});
