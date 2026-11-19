import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import { env } from "../../src/config/env.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "test/repo",
    name: "do-thing",
    description: "Does a thing",
    taskCategory: "refactor",
    skillMarkdown: "# Do thing\nSteps to do the thing.",
    utilityScore: 0.5,
    successCount: 1,
    failureCount: 1,
    lastUsedAt: new Date("2024-01-01"),
    createdAt: new Date("2024-01-01"),
    archivedAt: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makePrismaMock() {
  const agentSkill = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  const prisma = {
    agentSkill,
    $transaction: vi.fn(async (cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return prisma;
}

describe("mapAgentSkillToDocument", () => {
  it("projects an AgentSkill row into a SkillDocument", () => {
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
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new AgentSkillRepository(prisma);
  });

  it("create() persists a new skill with zeroed counters", async () => {
    prisma.agentSkill.create.mockResolvedValue(makeSkill());
    await repo.create({
      repoSlug: "test/repo",
      name: "do-thing",
      description: "desc",
      taskCategory: "refactor",
      skillMarkdown: "md",
    });
    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ utilityScore: 0, successCount: 0, failureCount: 0 }),
    });
  });

  it("findById() returns null for a missing id", async () => {
    prisma.agentSkill.findUnique.mockResolvedValue(null);
    expect(await repo.findById("missing")).toBeNull();
  });

  it("findByRepoCategoryNearTime() queries within the time window around the given date", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    const around = new Date("2024-06-01T00:00:00Z");
    await repo.findByRepoCategoryNearTime("test/repo", "refactor", around, 1000);
    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "test/repo",
        taskCategory: "refactor",
        createdAt: {
          gte: new Date(around.getTime() - 1000),
          lte: new Date(around.getTime() + 1000),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findActiveByRepo() only looks at non-archived skills", async () => {
    prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
    await repo.findActiveByRepo("test/repo");
    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "test/repo", archivedAt: null },
    });
  });

  it("countActiveByRepo() counts only non-archived skills", async () => {
    prisma.agentSkill.count.mockResolvedValue(2);
    expect(await repo.countActiveByRepo("test/repo")).toBe(2);
  });

  it("archiveById() sets archivedAt to the current time", async () => {
    prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
    await repo.archiveById("skill-1");
    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query and caps at MAX_SKILLS_INJECTED", async () => {
      const skills = [
        makeSkill({ id: "s1", taskCategory: "unrelated topic", skillMarkdown: "nothing matches" }),
        makeSkill({ id: "s2", taskCategory: "database migration", skillMarkdown: "database migration steps" }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const results = await repo.findTopKByRelevance("test/repo", "database migration", 10);
      expect(results.length).toBeLessThanOrEqual(env.MAX_SKILLS_INJECTED);
      expect(results[0].id).toBe("s2");
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const results = await repo.findTopKByRelevance("test/repo", "anything", 5);
      expect(results).toEqual([]);
    });
  });

  describe("incrementSuccess / incrementFailure", () => {
    it("incrementSuccess() increases successCount and recomputes utilityScore", async () => {
      const current = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(current);
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 }),
      );
      const result = await repo.incrementSuccess("skill-1");
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { successCount: 3, utilityScore: 3 / 5, lastUsedAt: expect.any(Date) },
      });
      expect(result.successCount).toBe(3);
    });

    it("incrementFailure() increases failureCount and recomputes utilityScore", async () => {
      const current = makeSkill({ successCount: 1, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(current);
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ successCount: 1, failureCount: 2, utilityScore: 1 / 4 }),
      );
      await repo.incrementFailure("skill-1");
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { failureCount: 2, utilityScore: 1 / 4, lastUsedAt: expect.any(Date) },
      });
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utility is low and it has been used enough times", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 5 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is low but usage count is below the threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 1 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility is high even with many uses", async () => {
      const skill = makeSkill({ utilityScore: 0.9, successCount: 10, failureCount: 1 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a replacement", async () => {
      const lowest = makeSkill({ id: "low-1", utilityScore: 0.01 });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      const created = makeSkill({ id: "new-1" });
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("test/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "refactor",
        skillMarkdown: "md",
      });

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-1" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(result.displacedSkillId).toBe("low-1");
      expect(result.newSkill.id).toBe("new-1");
    });

    it("throws when there are no active skills to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      await expect(
        repo.displaceAndCreate("test/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "refactor",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow(/No active skills found for repo test\/repo/);
    });
  });
});
