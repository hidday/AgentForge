import { describe, it, expect, vi } from "vitest";
import { AgentSkillRepository, mapAgentSkillToDocument } from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "test-skill",
    description: "A test skill",
    taskCategory: "testing",
    skillMarkdown: "# Test skill\nDo the thing.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
}

function makePrisma(agentSkillOverrides: Record<string, unknown> = {}, txImpl?: (tx: unknown) => unknown) {
  const agentSkill = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    ...agentSkillOverrides,
  };
  const prisma = {
    agentSkill,
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { agentSkill: txImpl ? txImpl(agentSkill) : agentSkill };
      return fn(tx);
    }),
  } as unknown as PrismaClient;
  return { prisma, agentSkill };
}

describe("mapAgentSkillToDocument / toSkillDocument", () => {
  it("maps an AgentSkill row to a SkillDocument with matching fields", () => {
    const skill = makeSkill({ id: "s1", name: "n", description: "d" });
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: "s1",
      repoSlug: "org/repo",
      name: "n",
      description: "d",
      taskCategory: "testing",
      skillMarkdown: skill.skillMarkdown,
      utilityScore: 0,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      const skill = makeSkill();
      const { prisma, agentSkill } = makePrisma({ create: vi.fn().mockResolvedValue(skill) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "test-skill",
        description: "A test skill",
        taskCategory: "testing",
        skillMarkdown: "# Test skill\nDo the thing.",
      });

      expect(agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "test-skill",
          description: "A test skill",
          taskCategory: "testing",
          skillMarkdown: "# Test skill\nDo the thing.",
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
      const skill = makeSkill();
      const { prisma, agentSkill } = makePrisma({ findUnique: vi.fn().mockResolvedValue(skill) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("skill-1");

      expect(agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when not found", async () => {
      const { prisma } = makePrisma({ findUnique: vi.fn().mockResolvedValue(null) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries with a time window derived from the given windowMs default", async () => {
      const skill = makeSkill();
      const { prisma, agentSkill } = makePrisma({ findFirst: vi.fn().mockResolvedValue(skill) });
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-01-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "testing", around);

      expect(agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "testing",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.id).toBe("skill-1");
    });

    it("honors a custom windowMs", async () => {
      const { prisma, agentSkill } = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-01-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "testing", around, 1000);

      expect(agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "testing",
          createdAt: {
            gte: new Date(around.getTime() - 1000),
            lte: new Date(around.getTime() + 1000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries non-archived skills for the repo", async () => {
      const skills = [makeSkill({ id: "s1" }), makeSkill({ id: "s2" })];
      const { prisma, agentSkill } = makePrisma({ findMany: vi.fn().mockResolvedValue(skills) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("org/repo");

      expect(agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      const { prisma, agentSkill } = makePrisma({ count: vi.fn().mockResolvedValue(7) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.countActiveByRepo("org/repo");

      expect(agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const skill = makeSkill();
      const { prisma, agentSkill } = makePrisma({ findFirst: vi.fn().mockResolvedValue(skill) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when there are no active skills", async () => {
      const { prisma } = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("org/repo");
      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      const { prisma, agentSkill } = makePrisma({ update: vi.fn().mockResolvedValue(makeSkill()) });
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveById("skill-1");

      expect(agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance and caps the result at min(k, MAX_SKILLS_INJECTED)", async () => {
      const skills = [
        makeSkill({
          id: "s-low",
          taskCategory: "unrelated",
          skillMarkdown: "Nothing to do with the query at all here.",
          name: null,
          description: null,
        }),
        makeSkill({
          id: "s-high",
          taskCategory: "database migrations",
          skillMarkdown: "How to run database migrations safely in production.",
          name: "db-migrations",
          description: "database migration helper",
        }),
      ];
      const { prisma, agentSkill } = makePrisma({ findMany: vi.fn().mockResolvedValue(skills) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "database migrations", 1);

      expect(agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("s-high");
    });

    it("returns an empty array when there are no active skills", async () => {
      const { prisma } = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);
      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
      const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
      const update = vi.fn().mockResolvedValue(updated);
      const { prisma } = makePrisma({}, () => ({ findUniqueOrThrow, update }));
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementSuccess("skill-1");

      expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / (3 + 1 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 2, failureCount: 2 });
      const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
      const update = vi.fn().mockResolvedValue(updated);
      const { prisma } = makePrisma({}, () => ({ findUniqueOrThrow, update }));
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementFailure("skill-1");

      expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / (2 + 2 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore < 0.2 and totalUses >= 5", async () => {
      const { prisma, agentSkill } = makePrisma({ update: vi.fn().mockResolvedValue(makeSkill()) });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "skill-low", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is high enough", async () => {
      const { prisma, agentSkill } = makePrisma();
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "skill-good", utilityScore: 0.5, successCount: 3, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when totalUses is below the threshold, even with low utility", async () => {
      const { prisma, agentSkill } = makePrisma();
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "skill-new", utilityScore: 0.05, successCount: 0, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one inside a transaction", async () => {
      const lowestUtility = makeSkill({ id: "skill-low", utilityScore: 0.01 });
      const newSkillRow = makeSkill({ id: "skill-new", name: "new-skill" });
      const findFirst = vi.fn().mockResolvedValue(lowestUtility);
      const update = vi.fn().mockResolvedValue(lowestUtility);
      const create = vi.fn().mockResolvedValue(newSkillRow);
      const { prisma } = makePrisma({}, () => ({ findFirst, update, create }));
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "# new",
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-low" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# new",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result.newSkill.id).toBe("skill-new");
      expect(result.displacedSkillId).toBe("skill-low");
    });

    it("throws when there are no active skills to displace", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const { prisma } = makePrisma({}, () => ({ findFirst }));
      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# new",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");
    });
  });
});
