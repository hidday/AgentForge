import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "acme/repo",
    name: "do-the-thing",
    description: "Does the thing",
    taskCategory: "backend",
    skillMarkdown: "# Do the thing\nSteps...",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function makeFakePrisma() {
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
    $transaction: vi.fn(async (cb: (tx: typeof prisma) => unknown) => cb(prisma)),
  };
  return prisma;
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument", () => {
    const skill = makeSkill({ utilityScore: 0.42 });
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: skill.id,
      repoSlug: skill.repoSlug,
      name: skill.name,
      description: skill.description,
      taskCategory: skill.taskCategory,
      skillMarkdown: skill.skillMarkdown,
      utilityScore: 0.42,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("calls agentSkill.create with zeroed counters and returns the created row", async () => {
      const prisma = makeFakePrisma();
      const created = makeSkill({ id: "new-skill" });
      prisma.agentSkill.create.mockResolvedValue(created);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.create({
        repoSlug: "acme/repo",
        name: "n",
        description: "d",
        taskCategory: "backend",
        skillMarkdown: "md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/repo",
          name: "n",
          description: "d",
          taskCategory: "backend",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toBe(created);
    });
  });

  describe("findById", () => {
    it("calls findUnique with the id and returns the row when found", async () => {
      const prisma = makeFakePrisma();
      const skill = makeSkill();
      prisma.agentSkill.findUnique.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      const prisma = makeFakePrisma();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("builds a time window around `around` using the default windowMs", async () => {
      const prisma = makeFakePrisma();
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-02-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("acme/repo", "backend", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("honors a custom windowMs", async () => {
      const prisma = makeFakePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-02-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("acme/repo", "backend", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/repo",
          taskCategory: "backend",
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
    it("calls findMany filtering non-archived skills for the repo", async () => {
      const prisma = makeFakePrisma();
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findActiveByRepo("acme/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = makeFakePrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findActiveByRepo("acme/repo");

      expect(result).toEqual([]);
    });
  });

  describe("countActiveByRepo", () => {
    it("calls count with the same non-archived filter", async () => {
      const prisma = makeFakePrisma();
      prisma.agentSkill.count.mockResolvedValue(7);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.countActiveByRepo("acme/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const prisma = makeFakePrisma();
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("acme/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when there are no active skills", async () => {
      const prisma = makeFakePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      expect(await repo.findLowestUtilityActive("acme/repo")).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("calls update with archivedAt set to a Date", async () => {
      const prisma = makeFakePrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills against the query and returns the top-k, best first", async () => {
      const prisma = makeFakePrisma();
      const skills = [
        makeSkill({
          id: "low",
          taskCategory: "unrelated-topic",
          skillMarkdown: "nothing relevant here at all",
          name: null,
          description: null,
        }),
        makeSkill({
          id: "high",
          taskCategory: "database migration",
          skillMarkdown: "database migration steps for postgres schema changes",
          name: "database-migration",
          description: "Migrate database schemas safely",
        }),
        makeSkill({
          id: "mid",
          taskCategory: "database",
          skillMarkdown: "general database notes",
          name: "database-notes",
          description: null,
        }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("acme/repo", "database migration", 2);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("high");
      expect(result.map((d) => d.id)).not.toContain("low");
    });

    it("caps results at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const prisma = makeFakePrisma();
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({
          id: `skill-${i}`,
          taskCategory: `topic-${i}`,
          skillMarkdown: `content for topic ${i}`,
        }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("acme/repo", "topic", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = makeFakePrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("acme/repo", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("loads the skill in a transaction and recomputes utilityScore from successCount", async () => {
      const prisma = makeFakePrisma();
      const skill = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(skill);
      prisma.agentSkill.update.mockResolvedValue(updated);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      // successCount 2 -> 3; utility = 3 / (3 + 1 + 1) = 0.6
      expect(call.data.successCount).toBe(3);
      expect(call.data.utilityScore).toBeCloseTo(0.6);
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toBe(updated);
    });
  });

  describe("incrementFailure", () => {
    it("loads the skill in a transaction and recomputes utilityScore from failureCount", async () => {
      const prisma = makeFakePrisma();
      const skill = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 2, failureCount: 2 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(skill);
      prisma.agentSkill.update.mockResolvedValue(updated);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      // failureCount 1 -> 2; utility = 2 / (2 + 2 + 1) = 0.4
      expect(call.data.failureCount).toBe(2);
      expect(call.data.utilityScore).toBeCloseTo(0.4);
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utility is below threshold and usage count meets the minimum", async () => {
      const prisma = makeFakePrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "low-util", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-util" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is at or above the threshold", async () => {
      const prisma = makeFakePrisma();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.5, successCount: 5, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses are below the minimum, even with low utility", async () => {
      const prisma = makeFakePrisma();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one in a transaction", async () => {
      const prisma = makeFakePrisma();
      const lowest = makeSkill({ id: "to-displace" });
      const created = makeSkill({ id: "new-skill" });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.create.mockResolvedValue(created);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("acme/repo", {
        name: "n",
        description: "d",
        taskCategory: "backend",
        skillMarkdown: "md",
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "to-displace" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/repo",
          name: "n",
          description: "d",
          taskCategory: "backend",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "to-displace" });
    });

    it("throws when there are no active skills to displace, without creating anything", async () => {
      const prisma = makeFakePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("acme/repo", {
          name: "n",
          description: "d",
          taskCategory: "backend",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo acme/repo to displace");

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
