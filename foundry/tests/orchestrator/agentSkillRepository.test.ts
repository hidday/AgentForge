import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "Use feature flags",
    description: "How to gate new behaviour behind flags",
    taskCategory: "backend",
    skillMarkdown: "# Feature flags\nUse the flags module.",
    utilityScore: 0.5,
    successCount: 1,
    failureCount: 1,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    $transaction: vi.fn(),
    ...overrides,
  };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument shape", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill as never);
    expect(doc).toEqual({
      id: "skill-1",
      repoSlug: "org/repo",
      name: "Use feature flags",
      description: "How to gate new behaviour behind flags",
      taskCategory: "backend",
      skillMarkdown: "# Feature flags\nUse the flags module.",
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates a skill with zeroed counters and score", async () => {
      const skill = makeSkill({ utilityScore: 0, successCount: 0, failureCount: 0 });
      const prisma = buildPrisma();
      prisma.agentSkill.create.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "Use feature flags",
        description: "desc",
        taskCategory: "backend",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "Use feature flags",
          description: "desc",
          taskCategory: "backend",
          skillMarkdown: "# md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toBe(skill);
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const skill = makeSkill();
      const prisma = buildPrisma();
      prisma.agentSkill.findUnique.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default +/-5s window", async () => {
      const skill = makeSkill();
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const around = new Date("2024-06-01T00:00:10.000Z");
      const result = await repo.findByRepoCategoryNearTime("org/repo", "backend", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date("2024-06-01T00:00:05.000Z"),
            lte: new Date("2024-06-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("respects a custom window size", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const around = new Date("2024-06-01T00:00:10.000Z");
      const result = await repo.findByRepoCategoryNearTime("org/repo", "backend", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date("2024-06-01T00:00:09.000Z"),
            lte: new Date("2024-06-01T00:00:11.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries non-archived skills for the repo", async () => {
      const skills = [makeSkill()];
      const prisma = buildPrisma();
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the active skill count for the repo", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.count.mockResolvedValue(4);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const skill = makeSkill();
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when there are no active skills", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date on the target skill", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance score, descending, limited to k", async () => {
      const skillHigh = makeSkill({
        id: "high",
        name: "Deploy with feature flags",
        description: "feature flag deploy guidance",
        skillMarkdown: "feature flag rollout feature flag rollout",
      });
      const skillLow = makeSkill({
        id: "low",
        name: "Unrelated topic",
        description: "something else entirely",
        skillMarkdown: "nothing matching here",
      });
      const prisma = buildPrisma();
      prisma.agentSkill.findMany.mockResolvedValue([skillLow, skillHigh]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("org/repo", "feature flag rollout", 5);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].id).toBe("high");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = Array.from({ length: 10 }, (_, i) => makeSkill({ id: `skill-${i}` }));
      const prisma = buildPrisma();
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("org/repo", "query text", 100);

      // env default MAX_SKILLS_INJECTED is 3
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("org/repo", "query", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const skill = makeSkill({ successCount: 2, failureCount: 1 });
      const prisma = buildPrisma();
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(skill),
          update: vi.fn().mockImplementation((args) =>
            Promise.resolve({ ...skill, ...args.data }),
          ),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newSuccessCount = 3, newUtilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 0.6,
          lastUsedAt: expect.any(Date),
        },
      });
      expect((result as { successCount: number }).successCount).toBe(3);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const skill = makeSkill({ successCount: 2, failureCount: 1 });
      const prisma = buildPrisma();
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(skill),
          update: vi.fn().mockImplementation((args) =>
            Promise.resolve({ ...skill, ...args.data }),
          ),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, newUtilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 0.4,
          lastUsedAt: expect.any(Date),
        },
      });
      expect((result as { failureCount: number }).failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utility is below 0.2 and at least 5 total uses", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });
      const prisma = buildPrisma();
      prisma.agentSkill.update.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is below 0.2 but total uses are under 5", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });
      const prisma = buildPrisma();
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility is at/above 0.2 regardless of use count", async () => {
      const skill = makeSkill({ utilityScore: 0.2, successCount: 5, failureCount: 5 });
      const prisma = buildPrisma();
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a new one in the same transaction", async () => {
      const lowestUtility = makeSkill({ id: "lowest", utilityScore: 0.05 });
      const newSkillRow = makeSkill({ id: "new-skill" });
      const prisma = buildPrisma();
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(lowestUtility),
          update: vi.fn().mockResolvedValue({ ...lowestUtility, archivedAt: new Date() }),
          create: vi.fn().mockResolvedValue(newSkillRow),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "New skill",
        description: "new desc",
        taskCategory: "backend",
        skillMarkdown: "# new",
      });

      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "New skill",
          description: "new desc",
          taskCategory: "backend",
          skillMarkdown: "# new",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result.newSkill).toBe(newSkillRow);
      expect(result.displacedSkillId).toBe("lowest");
    });

    it("throws when there are no active skills to displace", async () => {
      const prisma = buildPrisma();
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "New skill",
          description: "new desc",
          taskCategory: "backend",
          skillMarkdown: "# new",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
