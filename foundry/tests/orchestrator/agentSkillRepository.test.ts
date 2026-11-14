import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "agentforge",
    name: "name",
    description: "description",
    taskCategory: "bugfix",
    skillMarkdown: "# do the thing",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    archivedAt: null,
    ...overrides,
  };
}

function makePrisma() {
  const tx = {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  };
  return {
    agentSkill: tx.agentSkill,
    $transaction: vi.fn(async (callback: (tx: typeof tx) => unknown) => callback(tx)),
  };
}

describe("mapAgentSkillToDocument", () => {
  it("maps the Prisma skill row onto the SkillDocument shape", () => {
    const skill = makeSkill();
    expect(mapAgentSkillToDocument(skill as never)).toEqual({
      id: "skill-1",
      repoSlug: "agentforge",
      name: "name",
      description: "description",
      taskCategory: "bugfix",
      skillMarkdown: "# do the thing",
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma as never);
  });

  it("create() writes a fresh skill with zeroed counters", async () => {
    prisma.agentSkill.create.mockResolvedValue(makeSkill());

    await repo.create({
      repoSlug: "agentforge",
      name: "name",
      description: "description",
      taskCategory: "bugfix",
      skillMarkdown: "# do the thing",
    });

    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ utilityScore: 0.0, successCount: 0, failureCount: 0 }),
    });
  });

  it("findById() delegates to findUnique", async () => {
    prisma.agentSkill.findUnique.mockResolvedValue(makeSkill());
    const skill = await repo.findById("skill-1");
    expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    expect(skill?.id).toBe("skill-1");
  });

  it("findByRepoCategoryNearTime() queries within a +/- window around the given time", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    const around = new Date("2026-01-01T00:00:00.000Z");

    await repo.findByRepoCategoryNearTime("agentforge", "bugfix", around, 1000);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "agentforge",
        taskCategory: "bugfix",
        createdAt: {
          gte: new Date(around.getTime() - 1000),
          lte: new Date(around.getTime() + 1000),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findActiveByRepo() only queries skills that are not archived", async () => {
    prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);

    const skills = await repo.findActiveByRepo("agentforge");

    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "agentforge", archivedAt: null },
    });
    expect(skills).toHaveLength(1);
  });

  it("countActiveByRepo() returns the count of active skills", async () => {
    prisma.agentSkill.count.mockResolvedValue(3);
    expect(await repo.countActiveByRepo("agentforge")).toBe(3);
  });

  it("findLowestUtilityActive() orders by utility then last-used ascending", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());

    await repo.findLowestUtilityActive("agentforge");

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "agentforge", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
  });

  it("archiveById() sets archivedAt to the current time", async () => {
    prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));

    await repo.archiveById("skill-1");

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("findTopKByRelevance() scores and ranks active skills, capped by MAX_SKILLS_INJECTED", async () => {
    prisma.agentSkill.findMany.mockResolvedValue([
      makeSkill({ id: "low", taskCategory: "unrelated", skillMarkdown: "nothing in common" }),
      makeSkill({ id: "high", taskCategory: "bugfix", skillMarkdown: "fix the null pointer bug" }),
    ]);

    const top = await repo.findTopKByRelevance("agentforge", "fix the null pointer bug", 10);

    expect(top.length).toBeGreaterThan(0);
    expect(top[0].id).toBe("high");
  });

  it("findTopKByRelevance() returns an empty array when there are no active skills", async () => {
    prisma.agentSkill.findMany.mockResolvedValue([]);
    expect(await repo.findTopKByRelevance("agentforge", "anything", 5)).toEqual([]);
  });

  it("incrementSuccess() increments successCount and recomputes utilityScore inside a transaction", async () => {
    const skill = makeSkill({ successCount: 1, failureCount: 1 });
    prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(skill);
    prisma.agentSkill.update.mockImplementation(async ({ data }) => ({ ...skill, ...data }));

    const result = await repo.incrementSuccess("skill-1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result.successCount).toBe(2);
    expect(result.utilityScore).toBeCloseTo(2 / 4);
  });

  it("incrementFailure() increments failureCount and recomputes utilityScore inside a transaction", async () => {
    const skill = makeSkill({ successCount: 1, failureCount: 1 });
    prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(skill);
    prisma.agentSkill.update.mockImplementation(async ({ data }) => ({ ...skill, ...data }));

    const result = await repo.incrementFailure("skill-1");

    expect(result.failureCount).toBe(2);
    expect(result.utilityScore).toBeCloseTo(1 / 4);
  });

  describe("archiveIfLowUtility", () => {
    it("archives a skill with low utility and sufficient usage", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is low but usage count is below the threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility is at or above the threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.5, successCount: 3, failureCount: 3 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one in the same transaction", async () => {
      const lowest = makeSkill({ id: "lowest", utilityScore: 0.05 });
      const created = makeSkill({ id: "new-skill" });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("agentforge", {
        name: "new",
        description: "desc",
        taskCategory: "bugfix",
        skillMarkdown: "# new",
      });

      expect(result.displacedSkillId).toBe("lowest");
      expect(result.newSkill.id).toBe("new-skill");
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("throws when there are no active skills to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("agentforge", {
          name: "new",
          description: "desc",
          taskCategory: "bugfix",
          skillMarkdown: "# new",
        }),
      ).rejects.toThrow(/No active skills found for repo agentforge/);
    });
  });
});
