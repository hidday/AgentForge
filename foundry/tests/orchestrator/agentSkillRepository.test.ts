import { describe, it, expect, vi } from "vitest";
import { AgentSkillRepository, mapAgentSkillToDocument } from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function buildPrisma() {
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
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma;
}

function makeSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    repoSlug: "acme/widgets",
    name: "retry-flaky-tests",
    description: "Retries flaky tests",
    taskCategory: "testing",
    skillMarkdown: "# Retry flaky tests\nUse retries for flaky specs.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    archivedAt: null,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("AgentSkillRepository", () => {
  it("create() persists a new skill with zeroed counters/score", async () => {
    const prisma = buildPrisma();
    const skill = makeSkill();
    prisma.agentSkill.create.mockResolvedValue(skill);
    const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

    const result = await repo.create({
      repoSlug: "acme/widgets",
      name: "retry-flaky-tests",
      description: "Retries flaky tests",
      taskCategory: "testing",
      skillMarkdown: "# md",
    });

    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: {
        repoSlug: "acme/widgets",
        name: "retry-flaky-tests",
        description: "Retries flaky tests",
        taskCategory: "testing",
        skillMarkdown: "# md",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      },
    });
    expect(result).toEqual(skill);
  });

  it("findById() returns the skill when found, null otherwise", async () => {
    const prisma = buildPrisma();
    const skill = makeSkill();
    prisma.agentSkill.findUnique.mockResolvedValueOnce(skill).mockResolvedValueOnce(null);
    const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

    await expect(repo.findById("skill-1")).resolves.toEqual(skill);
    await expect(repo.findById("missing")).resolves.toBeNull();
    expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
  });

  it("findByRepoCategoryNearTime() queries a time window around the given date with default windowMs", async () => {
    const prisma = buildPrisma();
    const skill = makeSkill();
    prisma.agentSkill.findFirst.mockResolvedValue(skill);
    const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

    const around = new Date("2026-01-01T00:00:00Z");
    const result = await repo.findByRepoCategoryNearTime("acme/widgets", "testing", around);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "acme/widgets",
        taskCategory: "testing",
        createdAt: {
          gte: new Date(around.getTime() - 5000),
          lte: new Date(around.getTime() + 5000),
        },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toEqual(skill);
  });

  it("findByRepoCategoryNearTime() honors a custom windowMs", async () => {
    const prisma = buildPrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

    const around = new Date("2026-01-01T00:00:00Z");
    await repo.findByRepoCategoryNearTime("acme/widgets", "testing", around, 1000);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date(around.getTime() - 1000),
            lte: new Date(around.getTime() + 1000),
          },
        }),
      }),
    );
  });

  it("findActiveByRepo() filters by repoSlug and archivedAt: null", async () => {
    const prisma = buildPrisma();
    const skills = [makeSkill()];
    prisma.agentSkill.findMany.mockResolvedValue(skills);
    const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

    const result = await repo.findActiveByRepo("acme/widgets");

    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "acme/widgets", archivedAt: null },
    });
    expect(result).toEqual(skills);
  });

  it("countActiveByRepo() returns the count from prisma", async () => {
    const prisma = buildPrisma();
    prisma.agentSkill.count.mockResolvedValue(7);
    const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

    const result = await repo.countActiveByRepo("acme/widgets");

    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "acme/widgets", archivedAt: null },
    });
    expect(result).toBe(7);
  });

  it("findLowestUtilityActive() orders by utilityScore then lastUsedAt ascending", async () => {
    const prisma = buildPrisma();
    const skill = makeSkill();
    prisma.agentSkill.findFirst.mockResolvedValue(skill);
    const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

    const result = await repo.findLowestUtilityActive("acme/widgets");

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "acme/widgets", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
    expect(result).toEqual(skill);
  });

  it("findLowestUtilityActive() returns null when there are no active skills", async () => {
    const prisma = buildPrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

    const result = await repo.findLowestUtilityActive("acme/widgets");

    expect(result).toBeNull();
  });

  it("archiveById() sets archivedAt to a Date", async () => {
    const prisma = buildPrisma();
    prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
    const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

    await repo.archiveById("skill-1");

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  describe("findTopKByRelevance()", () => {
    it("scores active skills by relevance, sorts descending, and caps at min(k, MAX_SKILLS_INJECTED)", async () => {
      const prisma = buildPrisma();
      const skills = [
        makeSkill({ id: "s1", taskCategory: "testing", skillMarkdown: "unrelated content about widgets" }),
        makeSkill({ id: "s2", taskCategory: "flaky test retries", skillMarkdown: "flaky test retries guide" }),
        makeSkill({ id: "s3", taskCategory: "deployment", skillMarkdown: "deploy the app to prod" }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      // MAX_SKILLS_INJECTED defaults to 3, so asking for 10 should still cap at 3.
      const result = await repo.findTopKByRelevance("acme/widgets", "flaky test retries", 10);

      expect(result.length).toBeLessThanOrEqual(3);
      expect(result[0].id).toBe("s2");
    });

    it("maps results through toSkillDocument / mapAgentSkillToDocument consistently", async () => {
      const prisma = buildPrisma();
      const skill = makeSkill({ id: "s1", name: "retry", description: "desc" });
      prisma.agentSkill.findMany.mockResolvedValue([skill]);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const [doc] = await repo.findTopKByRelevance("acme/widgets", "retry", 1);

      expect(doc).toEqual(mapAgentSkillToDocument(skill));
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findTopKByRelevance("acme/widgets", "anything", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess()", () => {
    it("increments successCount, recomputes utilityScore, and updates lastUsedAt within a transaction", async () => {
      const prisma = buildPrisma();
      const skill = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(skill);
      prisma.agentSkill.update.mockResolvedValue({ ...skill, successCount: 3 });
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newSuccessCount = 3, utility = 3 / (3 + 1 + 1) = 0.6
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 0.6,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
    });
  });

  describe("incrementFailure()", () => {
    it("increments failureCount, recomputes utilityScore, and updates lastUsedAt within a transaction", async () => {
      const prisma = buildPrisma();
      const skill = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(skill);
      prisma.agentSkill.update.mockResolvedValue({ ...skill, failureCount: 2 });
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, utility = 2 / (2 + 2 + 1) = 0.4
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 0.4,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility()", () => {
    it("archives the skill when utilityScore < 0.2 and totalUses >= 5", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const skill = makeSkill({ id: "skill-low", utilityScore: 0.1, successCount: 1, failureCount: 5 });
      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is low but totalUses < 5", async () => {
      const prisma = buildPrisma();
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const skill = makeSkill({ id: "skill-low", utilityScore: 0.1, successCount: 1, failureCount: 2 });
      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utilityScore is not low even with many uses", async () => {
      const prisma = buildPrisma();
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const skill = makeSkill({ id: "skill-ok", utilityScore: 0.8, successCount: 8, failureCount: 2 });
      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate()", () => {
    it("archives the lowest-utility active skill and creates the new skill within a transaction", async () => {
      const prisma = buildPrisma();
      const lowest = makeSkill({ id: "skill-lowest", utilityScore: 0.05 });
      const created = makeSkill({ id: "skill-new", name: "new-skill" });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      prisma.agentSkill.create.mockResolvedValue(created);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.displaceAndCreate("acme/widgets", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "skill-lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      await expect(
        repo.displaceAndCreate("acme/widgets", {
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
        }),
      ).rejects.toThrow("No active skills found for repo acme/widgets to displace");

      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
