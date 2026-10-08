import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "retry-flaky-tests",
    description: "Retry flaky integration tests",
    taskCategory: "testing",
    skillMarkdown: "# Retry flaky tests\nUse exponential backoff.",
    utilityScore: 0,
    successCount: 0,
    failureCount: 0,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
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
  };
}

describe("mapAgentSkillToDocument", () => {
  it("projects the persisted skill fields into a SkillDocument", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill);

    expect(doc).toEqual({
      id: skill.id,
      repoSlug: skill.repoSlug,
      name: skill.name,
      description: skill.description,
      taskCategory: skill.taskCategory,
      skillMarkdown: skill.skillMarkdown,
      utilityScore: skill.utilityScore,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  it("create() seeds utilityScore/successCount/failureCount at zero", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.create.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma as never);

    await repo.create({
      repoSlug: "test-repo",
      name: "retry-flaky-tests",
      description: "Retry flaky integration tests",
      taskCategory: "testing",
      skillMarkdown: "# md",
    });

    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        repoSlug: "test-repo",
        utilityScore: 0,
        successCount: 0,
        failureCount: 0,
      }),
    });
  });

  it("findById() delegates to findUnique by id", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findUnique.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma as never);

    const skill = await repo.findById("skill-1");

    expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    expect(skill?.id).toBe("skill-1");
  });

  it("findByRepoCategoryNearTime() queries within a +/- window around the given time, defaulting to 5s", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma as never);
    const around = new Date("2024-06-01T12:00:00Z");

    await repo.findByRepoCategoryNearTime("test-repo", "testing", around);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "test-repo",
        taskCategory: "testing",
        createdAt: {
          gte: new Date("2024-06-01T11:59:55Z"),
          lte: new Date("2024-06-01T12:00:05Z"),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findByRepoCategoryNearTime() honors a custom window size", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma as never);
    const around = new Date("2024-06-01T12:00:00Z");

    await repo.findByRepoCategoryNearTime("test-repo", "testing", around, 1000);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "test-repo",
        taskCategory: "testing",
        createdAt: {
          gte: new Date("2024-06-01T11:59:59Z"),
          lte: new Date("2024-06-01T12:00:01Z"),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findActiveByRepo() filters to non-archived skills for the repo", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
    const repo = new AgentSkillRepository(prisma as never);

    const skills = await repo.findActiveByRepo("test-repo");

    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "test-repo", archivedAt: null },
    });
    expect(skills).toHaveLength(1);
  });

  it("countActiveByRepo() counts non-archived skills for the repo", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.count.mockResolvedValue(4);
    const repo = new AgentSkillRepository(prisma as never);

    const count = await repo.countActiveByRepo("test-repo");

    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "test-repo", archivedAt: null },
    });
    expect(count).toBe(4);
  });

  it("findLowestUtilityActive() orders by utilityScore then lastUsedAt ascending", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma as never);

    await repo.findLowestUtilityActive("test-repo");

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "test-repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
  });

  it("archiveById() stamps archivedAt with the current time", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
    const repo = new AgentSkillRepository(prisma as never);

    await repo.archiveById("skill-1");

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  describe("findTopKByRelevance()", () => {
    it("returns the k most relevant active skills as SkillDocuments, ranked by score", async () => {
      const prisma = makePrisma();
      const relevant = makeSkill({
        id: "skill-relevant",
        taskCategory: "testing",
        skillMarkdown: "flaky test retry backoff strategy",
      });
      const irrelevant = makeSkill({
        id: "skill-irrelevant",
        taskCategory: "deployment",
        skillMarkdown: "blue green deployment rollout",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);
      const repo = new AgentSkillRepository(prisma as never);

      const docs = await repo.findTopKByRelevance("test-repo", "flaky test retry backoff", 5);

      expect(docs[0].id).toBe("skill-relevant");
    });

    it("caps the returned count at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findMany.mockResolvedValue([
        makeSkill({ id: "s1" }),
        makeSkill({ id: "s2" }),
        makeSkill({ id: "s3" }),
        makeSkill({ id: "s4" }),
        makeSkill({ id: "s5" }),
      ]);
      const repo = new AgentSkillRepository(prisma as never);

      // MAX_SKILLS_INJECTED defaults to 3; requesting 5 should still cap at 3.
      const docs = await repo.findTopKByRelevance("test-repo", "anything", 5);

      expect(docs.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills for the repo", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const docs = await repo.findTopKByRelevance("test-repo", "anything", 3);

      expect(docs).toEqual([]);
    });
  });

  describe("incrementSuccess()", () => {
    it("increments successCount and recomputes utilityScore within a transaction", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(
        makeSkill({ successCount: 2, failureCount: 1 }),
      );
      prisma.agentSkill.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeSkill({ ...data })),
      );
      const repo = new AgentSkillRepository(prisma as never);

      const updated = await repo.incrementSuccess("skill-1");

      // successCount 2 -> 3, utilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({ successCount: 3, utilityScore: 0.6 }),
      });
      expect(updated.successCount).toBe(3);
    });
  });

  describe("incrementFailure()", () => {
    it("increments failureCount and recomputes utilityScore within a transaction", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(
        makeSkill({ successCount: 2, failureCount: 1 }),
      );
      prisma.agentSkill.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeSkill({ ...data })),
      );
      const repo = new AgentSkillRepository(prisma as never);

      const updated = await repo.incrementFailure("skill-1");

      // failureCount 1 -> 2, utilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({ failureCount: 2, utilityScore: 0.4 }),
      });
      expect(updated.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility()", () => {
    it("archives a skill with low utility and enough uses", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is low but total uses are below the threshold", async () => {
      const prisma = makePrisma();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility is at or above the threshold", async () => {
      const prisma = makePrisma();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.5, successCount: 5, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate()", () => {
    it("archives the lowest-utility active skill and creates the new one in the same transaction", async () => {
      const prisma = makePrisma();
      const lowest = makeSkill({ id: "skill-lowest", utilityScore: 0.01 });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ id: "skill-lowest", archivedAt: new Date() }));
      prisma.agentSkill.create.mockResolvedValue(makeSkill({ id: "skill-new" }));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("test-repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ repoSlug: "test-repo", name: "new-skill" }),
      });
      expect(result.displacedSkillId).toBe("skill-lowest");
      expect(result.newSkill.id).toBe("skill-new");
    });

    it("throws when there is no active skill to displace", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("test-repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
        }),
      ).rejects.toThrow('No active skills found for repo test-repo to displace');

      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
