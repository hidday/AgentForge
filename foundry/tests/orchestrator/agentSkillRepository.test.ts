import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "test-skill",
    description: "A test skill",
    taskCategory: "backend",
    skillMarkdown: "# Test skill\nDo the thing.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function makePrisma() {
  const tx = {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: typeof tx) => unknown) => fn(tx)),
    __tx: tx,
  };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument", () => {
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
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma as never);
  });

  describe("create", () => {
    it("creates a skill with zeroed score/counters", async () => {
      prisma.agentSkill.create.mockResolvedValue(makeSkill());
      const result = await repo.create({
        repoSlug: "org/repo",
        name: "test-skill",
        description: "A test skill",
        taskCategory: "backend",
        skillMarkdown: "# Test skill",
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "test-skill",
          description: "A test skill",
          taskCategory: "backend",
          skillMarkdown: "# Test skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result.id).toBe("skill-1");
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      prisma.agentSkill.findUnique.mockResolvedValue(makeSkill());
      const result = await repo.findById("skill-1");
      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when not found", async () => {
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const around = new Date("2026-01-01T00:00:10Z");
      const result = await repo.findByRepoCategoryNearTime("org/repo", "backend", around);
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.id).toBe("skill-1");
    });

    it("honors a custom window", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2026-01-01T00:00:10Z");
      const result = await repo.findByRepoCategoryNearTime("org/repo", "backend", around, 1000);
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date(around.getTime() - 1000),
            lte: new Date(around.getTime() + 1000),
          },
        }),
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("filters by repoSlug and archivedAt null", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const result = await repo.findActiveByRepo("org/repo");
      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the active skill count", async () => {
      prisma.agentSkill.count.mockResolvedValue(3);
      const result = await repo.countActiveByRepo("org/repo");
      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(3);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const result = await repo.findLowestUtilityActive("org/repo");
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when no active skills exist", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const result = await repo.findLowestUtilityActive("org/repo");
      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      await repo.archiveById("skill-1");
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("returns skills scored and sorted by relevance, capped at k", async () => {
      const skills = [
        makeSkill({ id: "s1", taskCategory: "database migration", skillMarkdown: "database migration steps" }),
        makeSkill({ id: "s2", taskCategory: "frontend styling", skillMarkdown: "css and styling tips" }),
        makeSkill({ id: "s3", taskCategory: "database schema", skillMarkdown: "database schema design" }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("org/repo", "database migration", 2);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(2);
      // The most relevant ("database migration") skill should be first.
      expect(result[0].id).toBe("s1");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `s${i}`, taskCategory: `category ${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("org/repo", "category", 999);

      expect(result.length).toBeLessThanOrEqual(10);
      expect(result.length).toBeLessThanOrEqual(3); // default MAX_SKILLS_INJECTED
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const result = await repo.findTopKByRelevance("org/repo", "anything", 5);
      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
      prisma.__tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.__tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ successCount: 2, failureCount: 2, utilityScore: 2 / 5 });
      prisma.__tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.__tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utility is low and usage count meets the threshold", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is low but usage count is below threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility score is at/above the threshold, even with many uses", () => {
      const skill = makeSkill({ utilityScore: 0.2, successCount: 10, failureCount: 10 });
      return repo.archiveIfLowUtility(skill).then(() => {
        expect(prisma.agentSkill.update).not.toHaveBeenCalled();
      });
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility skill and creates a new one inside a transaction", async () => {
      const lowest = makeSkill({ id: "low-1", utilityScore: 0.05 });
      prisma.__tx.agentSkill.findFirst.mockResolvedValue(lowest);
      const created = makeSkill({ id: "new-1" });
      prisma.__tx.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "backend",
        skillMarkdown: "# new",
      });

      expect(prisma.__tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-1" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.__tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "backend",
          skillMarkdown: "# new",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "low-1" });
    });

    it("throws when there is no active skill to displace", async () => {
      prisma.__tx.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "backend",
          skillMarkdown: "# new",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(prisma.__tx.agentSkill.update).not.toHaveBeenCalled();
      expect(prisma.__tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
