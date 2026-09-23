import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "acme/widgets",
    name: "deploy helper",
    description: "Helps deploy widgets",
    taskCategory: "deployment",
    skillMarkdown: "# Deploy\nRun the deploy script carefully.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    lastUsedAt: new Date("2024-01-02T00:00:00Z"),
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
  return {
    agentSkill,
    $transaction: vi.fn().mockImplementation((cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
  };
}

describe("mapAgentSkillToDocument", () => {
  it("maps a skill row to a SkillDocument shape", () => {
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
  let prisma: ReturnType<typeof buildPrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = buildPrisma();
    repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
  });

  describe("create", () => {
    it("creates a skill with zeroed counters", async () => {
      prisma.agentSkill.create.mockResolvedValue(makeSkill());
      const result = await repo.create({
        repoSlug: "acme/widgets",
        name: "deploy helper",
        description: "Helps deploy widgets",
        taskCategory: "deployment",
        skillMarkdown: "# Deploy",
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "deploy helper",
          description: "Helps deploy widgets",
          taskCategory: "deployment",
          skillMarkdown: "# Deploy",
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
    it("queries a time window around the given date using the default window", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const around = new Date("2024-01-01T00:00:10Z");
      const result = await repo.findByRepoCategoryNearTime("acme/widgets", "deployment", around);
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "deployment",
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
      const around = new Date("2024-01-01T00:00:10Z");
      const result = await repo.findByRepoCategoryNearTime("acme/widgets", "deployment", around, 1000);
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "deployment",
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
    it("finds non-archived skills for the repo", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const result = await repo.findActiveByRepo("acme/widgets");
      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      prisma.agentSkill.count.mockResolvedValue(4);
      const result = await repo.countActiveByRepo("acme/widgets");
      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const result = await repo.findLowestUtilityActive("acme/widgets");
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when there are no active skills", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const result = await repo.findLowestUtilityActive("acme/widgets");
      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to now", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      await repo.archiveById("skill-1");
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills against the query, sorts desc, and caps at MAX_SKILLS_INJECTED", async () => {
      const skills = [
        makeSkill({ id: "s-low", taskCategory: "unrelated", skillMarkdown: "totally different topic" }),
        makeSkill({ id: "s-high", taskCategory: "database migration", skillMarkdown: "database migration steps" }),
        makeSkill({ id: "s-mid", taskCategory: "database", skillMarkdown: "database notes" }),
        makeSkill({ id: "s-extra", taskCategory: "database migration tips", skillMarkdown: "database migration tips" }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      // k=10 but env default MAX_SKILLS_INJECTED=3 should cap the result length.
      const result = await repo.findTopKByRelevance("acme/widgets", "database migration", 10);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result.length).toBeLessThanOrEqual(3);
      // The most relevant skill (near-exact text match) should be first.
      expect(result[0]?.id).toBe("s-high");
    });

    it("caps at k when k is smaller than MAX_SKILLS_INJECTED", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill({ id: "a" }), makeSkill({ id: "b" })]);
      const result = await repo.findTopKByRelevance("acme/widgets", "anything", 1);
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const result = await repo.findTopKByRelevance("acme/widgets", "anything", 3);
      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("recomputes utility score from success/failure counts within a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
      prisma.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
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
    it("recomputes utility score from success/failure counts within a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ successCount: 2, failureCount: 2, utilityScore: 2 / 5 });
      prisma.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.$transaction).toHaveBeenCalled();
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
    it("archives when utility is below threshold and usage count meets the minimum", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 3, failureCount: 3 });
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is above the threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.5, successCount: 10, failureCount: 0 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses are below the minimum, even with low utility", async () => {
      const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 1 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility skill and creates the new one within a transaction", async () => {
      const lowest = makeSkill({ id: "s-lowest", utilityScore: 0.01 });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      const created = makeSkill({ id: "s-new" });
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("acme/widgets", {
        name: "new skill",
        description: "desc",
        taskCategory: "cat",
        skillMarkdown: "md",
      });

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "s-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "new skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "s-lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      await expect(
        repo.displaceAndCreate("acme/widgets", {
          name: "new skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow('No active skills found for repo acme/widgets to displace');
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
