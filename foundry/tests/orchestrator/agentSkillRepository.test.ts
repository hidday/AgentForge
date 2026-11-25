import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "Use feature flags",
    description: "How to roll out behind a flag",
    taskCategory: "feature-flag",
    skillMarkdown: "# Feature flags\nAlways gate new behavior behind a flag.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    lastUsedAt: new Date("2024-01-02T00:00:00Z"),
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
  const prisma = {
    agentSkill,
    $transaction: vi.fn(async (cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
  };
  return prisma;
}

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma as never);
  });

  describe("mapAgentSkillToDocument / toSkillDocument", () => {
    it("maps the persistence fields onto a SkillDocument", () => {
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

  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      prisma.agentSkill.create.mockResolvedValue(makeSkill());

      const result = await repo.create({
        repoSlug: "test-repo",
        name: "Use feature flags",
        description: "How to roll out behind a flag",
        taskCategory: "feature-flag",
        skillMarkdown: "# Feature flags",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "test-repo",
          name: "Use feature flags",
          description: "How to roll out behind a flag",
          taskCategory: "feature-flag",
          skillMarkdown: "# Feature flags",
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
    it("queries within the default +/-5s window around the given time", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const around = new Date("2024-01-01T00:00:10Z");

      const result = await repo.findByRepoCategoryNearTime("test-repo", "feature-flag", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "test-repo",
          taskCategory: "feature-flag",
          createdAt: {
            gte: new Date("2024-01-01T00:00:05Z"),
            lte: new Date("2024-01-01T00:00:15Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.id).toBe("skill-1");
    });

    it("honors a custom windowMs", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2024-01-01T00:00:10Z");

      const result = await repo.findByRepoCategoryNearTime(
        "test-repo",
        "feature-flag",
        around,
        1000,
      );

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "test-repo",
          taskCategory: "feature-flag",
          createdAt: {
            gte: new Date("2024-01-01T00:00:09Z"),
            lte: new Date("2024-01-01T00:00:11Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("filters by repoSlug and archivedAt: null", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const result = await repo.findActiveByRepo("test-repo");
      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts active (non-archived) skills for the repo", async () => {
      prisma.agentSkill.count.mockResolvedValue(4);
      const result = await repo.countActiveByRepo("test-repo");
      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill({ id: "low-util" }));
      const result = await repo.findLowestUtilityActive("test-repo");
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.id).toBe("low-util");
    });

    it("returns null when there are no active skills", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const result = await repo.findLowestUtilityActive("test-repo");
      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date on the targeted skill", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      await repo.archiveById("skill-1");
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills against the query and returns the top k, highest first", async () => {
      const good = makeSkill({
        id: "good",
        taskCategory: "auth-migration",
        skillMarkdown: "Migrate authentication to OAuth2 tokens for all API clients.",
      });
      const poor = makeSkill({
        id: "poor",
        taskCategory: "unrelated-topic",
        skillMarkdown: "Totally unrelated content about fruit baskets.",
      });
      prisma.agentSkill.findMany.mockResolvedValue([poor, good]);

      const result = await repo.findTopKByRelevance(
        "test-repo",
        "auth-migration",
        1,
        "Migrate authentication to OAuth2",
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("good");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `s${i}`, taskCategory: `cat${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      // env.MAX_SKILLS_INJECTED defaults to 3; requesting 10 should still cap at 3.
      const result = await repo.findTopKByRelevance("test-repo", "cat0", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when the repo has no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const result = await repo.findTopKByRelevance("test-repo", "anything", 3);
      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ id: "skill-1", successCount: 3, failureCount: 1, utilityScore: 3 / 5 }),
      );

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
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
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ id: "skill-1", successCount: 2, failureCount: 2, utilityScore: 2 / 5 }),
      );

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
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
    it("archives the skill when utility is below 0.2 and total uses >= 5", async () => {
      const lowUtilSkill = makeSkill({
        id: "skill-low",
        utilityScore: 0.1,
        successCount: 1,
        failureCount: 4,
      });
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));

      await repo.archiveIfLowUtility(lowUtilSkill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is low but total uses are below 5", async () => {
      const skill = makeSkill({
        id: "skill-new",
        utilityScore: 0.1,
        successCount: 0,
        failureCount: 2,
      });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility score is at or above 0.2 regardless of use count", async () => {
      const skill = makeSkill({
        id: "skill-healthy",
        utilityScore: 0.2,
        successCount: 5,
        failureCount: 5,
      });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one in the same transaction", async () => {
      const lowestUtility = makeSkill({ id: "to-displace", utilityScore: 0.05 });
      const newSkill = makeSkill({ id: "new-skill", taskCategory: "new-category" });

      prisma.agentSkill.findFirst.mockResolvedValue(lowestUtility);
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ id: "to-displace", archivedAt: new Date() }),
      );
      prisma.agentSkill.create.mockResolvedValue(newSkill);

      const result = await repo.displaceAndCreate("test-repo", {
        name: "New skill",
        description: "desc",
        taskCategory: "new-category",
        skillMarkdown: "# New",
      });

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "to-displace" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "test-repo",
          name: "New skill",
          description: "desc",
          taskCategory: "new-category",
          skillMarkdown: "# New",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "to-displace" });
    });

    it("throws when there is no active skill to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("test-repo", {
          name: "New skill",
          description: "desc",
          taskCategory: "new-category",
          skillMarkdown: "# New",
        }),
      ).rejects.toThrow("No active skills found for repo test-repo to displace");

      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
