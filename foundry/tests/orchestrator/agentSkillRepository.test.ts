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
    description: "Retries flaky tests with backoff",
    taskCategory: "testing",
    skillMarkdown: "# Retry flaky tests\nUse exponential backoff when a test is flaky.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

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
  const tx = { agentSkill };
  const $transaction = vi.fn().mockImplementation((cb: (tx: typeof tx) => unknown) => cb(tx));
  return { agentSkill, $transaction };
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
  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.create.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.create({
        repoSlug: "test-repo",
        name: "retry-flaky-tests",
        description: "Retries flaky tests",
        taskCategory: "testing",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "test-repo",
          name: "retry-flaky-tests",
          description: "Retries flaky tests",
          taskCategory: "testing",
          skillMarkdown: "# md",
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
      const prisma = buildPrisma();
      prisma.agentSkill.findUnique.mockResolvedValue(makeSkill({ id: "skill-7" }));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("skill-7");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-7" } });
      expect(result?.id).toBe("skill-7");
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
    it("queries with a time window derived from the given windowMs", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-01-01T00:00:10Z");

      const result = await repo.findByRepoCategoryNearTime("test-repo", "testing", around, 5000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "test-repo",
          taskCategory: "testing",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).not.toBeNull();
    });

    it("defaults the window to 5000ms when not specified", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-01-01T00:00:10Z");

      const result = await repo.findByRepoCategoryNearTime("test-repo", "testing", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date(around.getTime() - 5000),
              lte: new Date(around.getTime() + 5000),
            },
          }),
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries non-archived skills for the given repo", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findActiveByRepo("test-repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the active skill count for the repo", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.count.mockResolvedValue(4);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.countActiveByRepo("test-repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill({ utilityScore: 0.1 }));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("test-repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.utilityScore).toBe(0.1);
    });

    it("returns null when there are no active skills", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("test-repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a new Date on the given skill", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query and returns the top K as SkillDocuments", async () => {
      const prisma = buildPrisma();
      const relevantSkill = makeSkill({
        id: "skill-relevant",
        taskCategory: "database-migration",
        skillMarkdown: "# Database migration\nUse a migration tool to migrate database schemas safely.",
      });
      const irrelevantSkill = makeSkill({
        id: "skill-irrelevant",
        taskCategory: "unrelated-topic",
        skillMarkdown: "# Something else entirely\nzzz qqq xxx not related at all.",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevantSkill, relevantSkill]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("test-repo", "database migration schema", 2);

      expect(result).toHaveLength(2);
      // The more relevant skill should be ranked first.
      expect(result[0].id).toBe("skill-relevant");
      expect(result.map((r) => r.id)).toContain("skill-irrelevant");
    });

    it("caps the returned count at env.MAX_SKILLS_INJECTED even if k is larger", async () => {
      const prisma = buildPrisma();
      const skills = Array.from({ length: 6 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: `category-${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      // env.MAX_SKILLS_INJECTED defaults to 3; ask for far more than that.
      const result = await repo.findTopKByRelevance("test-repo", "category", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("test-repo", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore within a transaction", async () => {
      const prisma = buildPrisma();
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...existing, ...args.data }),
      );
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newSuccessCount = 3, newUtilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 0.6,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
      expect(result.utilityScore).toBeCloseTo(0.6);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore within a transaction", async () => {
      const prisma = buildPrisma();
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...existing, ...args.data }),
      );
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, newUtilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 0.4,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
      expect(result.utilityScore).toBeCloseTo(0.4);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives a skill with low utility and enough uses", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as never);

      const skill = makeSkill({ id: "skill-low", utilityScore: 0.1, successCount: 1, failureCount: 4 });
      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is low but total uses are below the threshold", async () => {
      const prisma = buildPrisma();
      const repo = new AgentSkillRepository(prisma as never);

      const skill = makeSkill({ id: "skill-new", utilityScore: 0.1, successCount: 1, failureCount: 1 });
      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility is at or above the threshold even with many uses", async () => {
      const prisma = buildPrisma();
      const repo = new AgentSkillRepository(prisma as never);

      const skill = makeSkill({ id: "skill-ok", utilityScore: 0.2, successCount: 5, failureCount: 5 });
      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a new one in its place", async () => {
      const prisma = buildPrisma();
      const lowest = makeSkill({ id: "skill-lowest", utilityScore: 0.05 });
      const created = makeSkill({ id: "skill-new", name: "new-skill" });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      prisma.agentSkill.create.mockResolvedValue(created);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("test-repo", {
        name: "new-skill",
        description: "A new skill",
        taskCategory: "testing",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "test-repo",
          name: "new-skill",
          description: "A new skill",
          taskCategory: "testing",
          skillMarkdown: "# md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "skill-lowest" });
    });

    it("throws when there are no active skills to displace", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("test-repo", {
          name: "new-skill",
          description: "A new skill",
          taskCategory: "testing",
          skillMarkdown: "# md",
        }),
      ).rejects.toThrow("No active skills found for repo test-repo to displace");

      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
