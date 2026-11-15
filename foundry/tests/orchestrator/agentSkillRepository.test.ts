import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "fix-flaky-tests",
    description: "Stabilizes flaky integration tests",
    taskCategory: "testing",
    skillMarkdown: "# Fix flaky tests\nRetry transient network calls.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    archivedAt: null,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma() {
  const agentSkill = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  return {
    agentSkill,
    $transaction: vi.fn(async (cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("mapAgentSkillToDocument", () => {
  it("maps every field to the SkillDocument shape", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: "skill-1",
      repoSlug: "org/repo",
      name: "fix-flaky-tests",
      description: "Stabilizes flaky integration tests",
      taskCategory: "testing",
      skillMarkdown: skill.skillMarkdown,
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  it("create() seeds utility/success/failure at zero", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.create.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma);

    await repo.create({
      repoSlug: "org/repo",
      name: "fix-flaky-tests",
      description: "desc",
      taskCategory: "testing",
      skillMarkdown: "md",
    });

    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: {
        repoSlug: "org/repo",
        name: "fix-flaky-tests",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "md",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      },
    });
  });

  it("findById() returns null when absent", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findUnique.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findById("missing");

    expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "missing" } });
    expect(result).toBeNull();
  });

  it("findByRepoCategoryNearTime() queries a time window around `around` with the default 5s window", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma);
    const around = new Date("2024-01-01T00:00:10.000Z");

    await repo.findByRepoCategoryNearTime("org/repo", "testing", around);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "org/repo",
        taskCategory: "testing",
        createdAt: {
          gte: new Date("2024-01-01T00:00:05.000Z"),
          lte: new Date("2024-01-01T00:00:15.000Z"),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findByRepoCategoryNearTime() honors a custom windowMs", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma);
    const around = new Date("2024-01-01T00:00:10.000Z");

    await repo.findByRepoCategoryNearTime("org/repo", "testing", around, 1000);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date("2024-01-01T00:00:09.000Z"),
            lte: new Date("2024-01-01T00:00:11.000Z"),
          },
        }),
      }),
    );
  });

  it("findActiveByRepo() filters out archived skills", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findActiveByRepo("org/repo");

    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
    expect(result).toHaveLength(1);
  });

  it("countActiveByRepo() counts only non-archived skills", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.count.mockResolvedValue(4);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.countActiveByRepo("org/repo");

    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
    expect(result).toBe(4);
  });

  it("findLowestUtilityActive() orders by utilityScore asc then lastUsedAt asc", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill({ utilityScore: 0.1 }));
    const repo = new AgentSkillRepository(prisma);

    await repo.findLowestUtilityActive("org/repo");

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
  });

  it("findLowestUtilityActive() returns null when there are no active skills", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findLowestUtilityActive("org/repo");

    expect(result).toBeNull();
  });

  it("archiveById() sets archivedAt to a Date", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.update.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma);

    await repo.archiveById("skill-1");

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("findTopKByRelevance() scores, sorts descending, and caps at min(k, MAX_SKILLS_INJECTED=3)", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findMany.mockResolvedValue([
      makeSkill({ id: "a", taskCategory: "testing", skillMarkdown: "flaky test retries" }),
      makeSkill({ id: "b", taskCategory: "deploy", skillMarkdown: "ci pipeline deploy" }),
      makeSkill({ id: "c", taskCategory: "testing", skillMarkdown: "flaky test timeouts" }),
      makeSkill({ id: "d", taskCategory: "docs", skillMarkdown: "write release notes" }),
    ]);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findTopKByRelevance("org/repo", "flaky testing retries", 10);

    expect(result.length).toBeLessThanOrEqual(3);
    // The two "testing" skills about flaky tests should outrank the unrelated ones.
    expect(result[0].id).toBe("a");
  });

  it("findTopKByRelevance() respects a k smaller than MAX_SKILLS_INJECTED", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findMany.mockResolvedValue([
      makeSkill({ id: "a" }),
      makeSkill({ id: "b" }),
      makeSkill({ id: "c" }),
    ]);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findTopKByRelevance("org/repo", "anything", 1);

    expect(result).toHaveLength(1);
  });

  it("findTopKByRelevance() returns an empty array when there are no active skills", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findMany.mockResolvedValue([]);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findTopKByRelevance("org/repo", "anything", 3);

    expect(result).toEqual([]);
  });

  it("incrementSuccess() bumps successCount and recomputes utilityScore inside a transaction", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(
      makeSkill({ successCount: 2, failureCount: 1 }),
    );
    prisma.agentSkill.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({ ...makeSkill(), ...args.data }),
    );
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.incrementSuccess("skill-1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        successCount: 3,
        utilityScore: 3 / (3 + 1 + 1),
        lastUsedAt: expect.any(Date),
      },
    });
    expect(result.successCount).toBe(3);
  });

  it("incrementFailure() bumps failureCount and recomputes utilityScore inside a transaction", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(
      makeSkill({ successCount: 2, failureCount: 1 }),
    );
    prisma.agentSkill.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({ ...makeSkill(), ...args.data }),
    );
    const repo = new AgentSkillRepository(prisma);

    await repo.incrementFailure("skill-1");

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        failureCount: 2,
        utilityScore: 2 / (2 + 2 + 1),
        lastUsedAt: expect.any(Date),
      },
    });
  });

  it("archiveIfLowUtility() archives when utilityScore < 0.2 and totalUses >= 5", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.update.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma);

    await repo.archiveIfLowUtility(makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 }));

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("archiveIfLowUtility() does not archive when utilityScore is low but totalUses < 5", async () => {
    const prisma = makePrisma();
    const repo = new AgentSkillRepository(prisma);

    await repo.archiveIfLowUtility(makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 1 }));

    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });

  it("archiveIfLowUtility() does not archive when utilityScore is >= 0.2 regardless of usage", async () => {
    const prisma = makePrisma();
    const repo = new AgentSkillRepository(prisma);

    await repo.archiveIfLowUtility(makeSkill({ utilityScore: 0.5, successCount: 10, failureCount: 10 }));

    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });

  it("displaceAndCreate() archives the lowest-utility active skill and creates the new one in a transaction", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill({ id: "low-utility" }));
    prisma.agentSkill.create.mockResolvedValue(makeSkill({ id: "new-skill" }));
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.displaceAndCreate("org/repo", {
      name: "new-skill",
      description: "desc",
      taskCategory: "testing",
      skillMarkdown: "md",
    });

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "low-utility" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: {
        repoSlug: "org/repo",
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "md",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      },
    });
    expect(result).toEqual({
      newSkill: makeSkill({ id: "new-skill" }),
      displacedSkillId: "low-utility",
    });
  });

  it("displaceAndCreate() throws when there is no active skill to displace", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma);

    await expect(
      repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "md",
      }),
    ).rejects.toThrow("No active skills found for repo org/repo to displace");
    expect(prisma.agentSkill.create).not.toHaveBeenCalled();
  });
});
