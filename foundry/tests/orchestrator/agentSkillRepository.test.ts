import { describe, it, expect, vi } from "vitest";
import { AgentSkillRepository, mapAgentSkillToDocument } from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "do-the-thing",
    description: "Does the thing",
    taskCategory: "bugfix",
    skillMarkdown: "# Do the thing\nSteps...",
    utilityScore: 0.5,
    successCount: 1,
    failureCount: 1,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    archivedAt: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(methods: Record<string, unknown> = {}) {
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      ...methods,
    },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(undefined)),
  } as unknown as import("../../src/generated/prisma/client.js").PrismaClient;
}

describe("mapAgentSkillToDocument", () => {
  it("projects a skill row into a SkillDocument", () => {
    const skill = makeSkill();
    expect(mapAgentSkillToDocument(skill)).toEqual({
      id: "skill-1",
      repoSlug: "org/repo",
      name: "do-the-thing",
      description: "Does the thing",
      taskCategory: "bugfix",
      skillMarkdown: "# Do the thing\nSteps...",
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  it("creates a skill with zeroed utility/success/failure counters", async () => {
    const create = vi.fn().mockResolvedValue(makeSkill());
    const prisma = makePrisma({ create });
    const repo = new AgentSkillRepository(prisma);

    await repo.create({
      repoSlug: "org/repo",
      name: "do-the-thing",
      description: "Does the thing",
      taskCategory: "bugfix",
      skillMarkdown: "# markdown",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        repoSlug: "org/repo",
        name: "do-the-thing",
        description: "Does the thing",
        taskCategory: "bugfix",
        skillMarkdown: "# markdown",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      },
    });
  });

  it("findById delegates to findUnique", async () => {
    const findUnique = vi.fn().mockResolvedValue(makeSkill());
    const prisma = makePrisma({ findUnique });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findById("skill-1");

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    expect(result?.id).toBe("skill-1");
  });

  it("findById returns null when not found", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findUnique });
    const repo = new AgentSkillRepository(prisma);

    expect(await repo.findById("missing")).toBeNull();
  });

  it("findByRepoCategoryNearTime queries within the default 5s window", async () => {
    const findFirst = vi.fn().mockResolvedValue(makeSkill());
    const prisma = makePrisma({ findFirst });
    const repo = new AgentSkillRepository(prisma);
    const around = new Date("2024-06-01T12:00:00Z");

    await repo.findByRepoCategoryNearTime("org/repo", "bugfix", around);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "org/repo",
        taskCategory: "bugfix",
        createdAt: {
          gte: new Date(around.getTime() - 5000),
          lte: new Date(around.getTime() + 5000),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findByRepoCategoryNearTime respects a custom window", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new AgentSkillRepository(prisma);
    const around = new Date("2024-06-01T12:00:00Z");

    const result = await repo.findByRepoCategoryNearTime("org/repo", "bugfix", around, 1000);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: new Date(around.getTime() - 1000), lte: new Date(around.getTime() + 1000) },
        }),
      }),
    );
    expect(result).toBeNull();
  });

  it("findActiveByRepo filters out archived skills", async () => {
    const findMany = vi.fn().mockResolvedValue([makeSkill()]);
    const prisma = makePrisma({ findMany });
    const repo = new AgentSkillRepository(prisma);

    await repo.findActiveByRepo("org/repo");

    expect(findMany).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
  });

  it("countActiveByRepo counts non-archived skills", async () => {
    const count = vi.fn().mockResolvedValue(3);
    const prisma = makePrisma({ count });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.countActiveByRepo("org/repo");

    expect(count).toHaveBeenCalledWith({ where: { repoSlug: "org/repo", archivedAt: null } });
    expect(result).toBe(3);
  });

  it("findLowestUtilityActive orders by utilityScore then lastUsedAt ascending", async () => {
    const findFirst = vi.fn().mockResolvedValue(makeSkill());
    const prisma = makePrisma({ findFirst });
    const repo = new AgentSkillRepository(prisma);

    await repo.findLowestUtilityActive("org/repo");

    expect(findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
  });

  it("findLowestUtilityActive returns null when nothing is active", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findFirst });
    const repo = new AgentSkillRepository(prisma);

    expect(await repo.findLowestUtilityActive("org/repo")).toBeNull();
  });

  it("archiveById stamps archivedAt on the skill", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const prisma = makePrisma({ update });
    const repo = new AgentSkillRepository(prisma);

    await repo.archiveById("skill-1");

    expect(update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("findTopKByRelevance ranks active skills by relevance and caps at env.MAX_SKILLS_INJECTED", async () => {
    const skills = [
      makeSkill({ id: "s1", taskCategory: "totally unrelated", skillMarkdown: "nothing like it" }),
      makeSkill({ id: "s2", taskCategory: "deploy pipeline", skillMarkdown: "deploy pipeline steps" }),
      makeSkill({ id: "s3", taskCategory: "deploy pipeline setup", skillMarkdown: "deploy pipeline setup" }),
    ];
    const findMany = vi.fn().mockResolvedValue(skills);
    const prisma = makePrisma({ findMany });
    const repo = new AgentSkillRepository(prisma);

    // env default MAX_SKILLS_INJECTED is 3, so asking for 10 should still cap at 3.
    const result = await repo.findTopKByRelevance("org/repo", "deploy pipeline", 10);

    expect(result.length).toBeLessThanOrEqual(3);
    // s1's taskCategory/skillMarkdown share no trigrams with the query, so it ranks last.
    expect(result[result.length - 1].id).toBe("s1");
  });

  it("findTopKByRelevance returns an empty array when there are no active skills", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findTopKByRelevance("org/repo", "anything", 5);

    expect(result).toEqual([]);
  });

  it("incrementSuccess bumps successCount and recomputes utilityScore inside a transaction", async () => {
    const existing = makeSkill({ successCount: 2, failureCount: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data }));
    const tx = { agentSkill: { findUniqueOrThrow, update } };
    const prisma = {
      agentSkill: {},
      $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as import("../../src/generated/prisma/client.js").PrismaClient;
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.incrementSuccess("skill-1");

    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    // newSuccessCount = 3, utility = 3 / (3 + 1 + 1) = 0.6
    expect(update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { successCount: 3, utilityScore: 0.6, lastUsedAt: expect.any(Date) },
    });
    expect(result.successCount).toBe(3);
  });

  it("incrementFailure bumps failureCount and recomputes utilityScore inside a transaction", async () => {
    const existing = makeSkill({ successCount: 2, failureCount: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data }));
    const tx = { agentSkill: { findUniqueOrThrow, update } };
    const prisma = {
      agentSkill: {},
      $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as import("../../src/generated/prisma/client.js").PrismaClient;
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.incrementFailure("skill-1");

    // newFailureCount = 2, utility = 2 / (2 + 2 + 1) = 0.4
    expect(update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { failureCount: 2, utilityScore: 0.4, lastUsedAt: expect.any(Date) },
    });
    expect(result.failureCount).toBe(2);
  });

  it("archiveIfLowUtility archives when utility is below 0.2 with at least 5 total uses", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const prisma = makePrisma({ update });
    const repo = new AgentSkillRepository(prisma);
    const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });

    await repo.archiveIfLowUtility(skill);

    expect(update).toHaveBeenCalledWith({
      where: { id: skill.id },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("archiveIfLowUtility does not archive when utility is low but uses are below 5", async () => {
    const update = vi.fn();
    const prisma = makePrisma({ update });
    const repo = new AgentSkillRepository(prisma);
    const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });

    await repo.archiveIfLowUtility(skill);

    expect(update).not.toHaveBeenCalled();
  });

  it("archiveIfLowUtility does not archive when utility is at or above 0.2", async () => {
    const update = vi.fn();
    const prisma = makePrisma({ update });
    const repo = new AgentSkillRepository(prisma);
    const skill = makeSkill({ utilityScore: 0.5, successCount: 5, failureCount: 5 });

    await repo.archiveIfLowUtility(skill);

    expect(update).not.toHaveBeenCalled();
  });

  it("displaceAndCreate archives the lowest-utility skill and creates a new one in its place", async () => {
    const lowestUtility = makeSkill({ id: "low-1", utilityScore: 0.05 });
    const createdSkill = makeSkill({ id: "new-1", utilityScore: 0 });
    const findFirst = vi.fn().mockResolvedValue(lowestUtility);
    const update = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(createdSkill);
    const tx = { agentSkill: { findFirst, update, create } };
    const prisma = {
      agentSkill: {},
      $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as import("../../src/generated/prisma/client.js").PrismaClient;
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.displaceAndCreate("org/repo", {
      name: "new-skill",
      description: "desc",
      taskCategory: "bugfix",
      skillMarkdown: "# new",
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "low-1" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        repoSlug: "org/repo",
        name: "new-skill",
        description: "desc",
        taskCategory: "bugfix",
        skillMarkdown: "# new",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      },
    });
    expect(result.newSkill.id).toBe("new-1");
    expect(result.displacedSkillId).toBe("low-1");
  });

  it("displaceAndCreate throws when there are no active skills to displace", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const tx = { agentSkill: { findFirst } };
    const prisma = {
      agentSkill: {},
      $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as import("../../src/generated/prisma/client.js").PrismaClient;
    const repo = new AgentSkillRepository(prisma);

    await expect(
      repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "bugfix",
        skillMarkdown: "# new",
      }),
    ).rejects.toThrow("No active skills found for repo org/repo to displace");
  });
});
