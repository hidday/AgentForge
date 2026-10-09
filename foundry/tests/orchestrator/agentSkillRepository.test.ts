import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
} from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "Do the thing",
    description: "Describes the thing",
    taskCategory: "refactor",
    skillMarkdown: "# Do the thing\nSteps...",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  } as unknown as PrismaClient & {
    agentSkill: Record<string, ReturnType<typeof vi.fn>>;
    $transaction: ReturnType<typeof vi.fn>;
  };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to its SkillDocument projection", () => {
    const skill = makeSkill();
    expect(mapAgentSkillToDocument(skill)).toEqual({
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
      const prisma = makePrismaMock();
      const skill = makeSkill();
      prisma.agentSkill.create.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "Do the thing",
        description: "Describes the thing",
        taskCategory: "refactor",
        skillMarkdown: "# Do the thing\nSteps...",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "Do the thing",
          description: "Describes the thing",
          taskCategory: "refactor",
          skillMarkdown: "# Do the thing\nSteps...",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual(skill);
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const prisma = makePrismaMock();
      const skill = makeSkill();
      prisma.agentSkill.findUnique.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toEqual(skill);
    });

    it("returns null when not found", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default time window ordered by most recent", async () => {
      const prisma = makePrismaMock();
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2024-06-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "refactor", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "refactor",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(skill);
    });

    it("honors a custom windowMs", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2024-06-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "refactor", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "refactor",
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
    it("returns only non-archived skills for the repo", async () => {
      const prisma = makePrismaMock();
      const skills = [makeSkill({ id: "s1" }), makeSkill({ id: "s2" })];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toEqual(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.count.mockResolvedValue(7);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utility score then last-used ascending", async () => {
      const prisma = makePrismaMock();
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toEqual(skill);
    });

    it("returns null when no active skills exist", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma);
      const before = Date.now();

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
      expect(call.data.archivedAt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills against the query and returns the top K as documents", async () => {
      const prisma = makePrismaMock();
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "refactor",
        skillMarkdown: "refactor the authentication module safely",
        name: "Refactor auth",
        description: "Refactor the auth module",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "docs",
        skillMarkdown: "write release notes for the changelog",
        name: "Write changelog",
        description: "Write changelog entries",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "refactor the auth module", 1);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("relevant");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const prisma = makePrismaMock();
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({
          id: `s${i}`,
          taskCategory: "refactor",
          skillMarkdown: `refactor module ${i}`,
        }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "refactor module", 50);

      // env.MAX_SKILLS_INJECTED defaults to 3 (schema max is 10)
      expect(result.length).toBeLessThanOrEqual(10);
      expect(result.length).toBeLessThan(skills.length);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount, recomputes utilityScore, and touches lastUsedAt inside a transaction", async () => {
      const prisma = makePrismaMock();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue({ ...existing, successCount: 3 }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma);

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
      expect(result).toEqual({ ...existing, successCount: 3 });
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount, recomputes utilityScore, and touches lastUsedAt inside a transaction", async () => {
      const prisma = makePrismaMock();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue({ ...existing, failureCount: 2 }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementFailure("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newFailureCount = 2, newUtilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 0.4,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toEqual({ ...existing, failureCount: 2 });
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utility is below threshold and usage count meets the minimum", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ utilityScore: 0.1, successCount: 2, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is at or above threshold", async () => {
      const prisma = makePrismaMock();
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ utilityScore: 0.2, successCount: 3, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses are below the minimum, even with low utility", async () => {
      const prisma = makePrismaMock();
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new skill inside a transaction", async () => {
      const prisma = makePrismaMock();
      const lowestUtility = makeSkill({ id: "lowest" });
      const newSkill = makeSkill({ id: "new-skill", name: "New skill" });
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(lowestUtility),
          update: vi.fn().mockResolvedValue({ ...lowestUtility, archivedAt: new Date() }),
          create: vi.fn().mockResolvedValue(newSkill),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "New skill",
        description: "A new skill",
        taskCategory: "refactor",
        skillMarkdown: "# New skill",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "New skill",
          description: "A new skill",
          taskCategory: "refactor",
          skillMarkdown: "# New skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      const prisma = makePrismaMock();
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "New skill",
          description: "A new skill",
          taskCategory: "refactor",
          skillMarkdown: "# New skill",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
