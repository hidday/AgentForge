import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import { scoreSkillRelevance } from "../../src/utils/similarity.js";
import { env } from "../../src/config/env.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makePrismaMock() {
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
  };
}

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "deploy-checklist",
    description: "How to deploy safely",
    taskCategory: "deployment",
    skillMarkdown: "# Deploy checklist\nAlways run migrations first.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

describe("AgentSkillRepository", () => {
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

  describe("create", () => {
    it("creates a skill with zeroed counters and returns the raw row", async () => {
      const prisma = makePrismaMock();
      const created = makeSkill();
      prisma.agentSkill.create.mockResolvedValue(created);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "deploy-checklist",
        description: "How to deploy safely",
        taskCategory: "deployment",
        skillMarkdown: "# Deploy checklist",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "deploy-checklist",
          description: "How to deploy safely",
          taskCategory: "deployment",
          skillMarkdown: "# Deploy checklist",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toBe(created);
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const prisma = makePrismaMock();
      const skill = makeSkill();
      prisma.agentSkill.findUnique.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window around the given time", async () => {
      const prisma = makePrismaMock();
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
      const around = new Date("2026-02-01T12:00:00.000Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "deployment", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date("2026-02-01T11:59:55.000Z"),
            lte: new Date("2026-02-01T12:00:05.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("honors a custom windowMs", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
      const around = new Date("2026-02-01T12:00:00.000Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "deployment", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date("2026-02-01T11:59:59.000Z"),
            lte: new Date("2026-02-01T12:00:01.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries non-archived skills for the repo", async () => {
      const prisma = makePrismaMock();
      const skills = [makeSkill()];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.count.mockResolvedValue(7);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      const prisma = makePrismaMock();
      const skill = makeSkill({ utilityScore: 0.1 });
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when there are no active skills", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance and returns SkillDocuments in descending score order", async () => {
      const prisma = makePrismaMock();
      const skills = [
        makeSkill({
          id: "s-deploy",
          taskCategory: "deployment",
          skillMarkdown: "How to safely deploy the service to production",
          name: "deploy-checklist",
          description: "Deployment steps",
        }),
        makeSkill({
          id: "s-unrelated",
          taskCategory: "unrelated topic",
          skillMarkdown: "Completely different content about baking bread",
          name: "bread-recipe",
          description: "Baking instructions",
        }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
      const query = "how do I deploy the service";

      const result = await repo.findTopKByRelevance("org/repo", query, 2);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });

      const expectedScores = skills
        .map((skill) => ({
          skill,
          score: scoreSkillRelevance(
            {
              taskCategory: skill.taskCategory,
              skillMarkdown: skill.skillMarkdown,
              name: skill.name,
              description: skill.description,
            },
            query,
          ),
        }))
        .sort((a, b) => b.score - a.score);

      expect(result.map((d) => d.id)).toEqual(expectedScores.map((e) => e.skill.id));
      expect(result[0]).toEqual(mapAgentSkillToDocument(expectedScores[0].skill));
      // The deployment-focused skill must score more relevant than the unrelated one.
      expect(result[0].id).toBe("s-deploy");
    });

    it("caps the number of results at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const prisma = makePrismaMock();
      const skills = Array.from({ length: env.MAX_SKILLS_INJECTED + 2 }, (_, i) =>
        makeSkill({
          id: `s-${i}`,
          taskCategory: `category-${i}`,
          skillMarkdown: `Markdown content number ${i} about topic ${i}`,
        }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findTopKByRelevance("org/repo", "topic query", 100);

      expect(result.length).toBe(env.MAX_SKILLS_INJECTED);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const prisma = makePrismaMock();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      const updated = makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue(updated),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const prisma = makePrismaMock();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      const updated = makeSkill({ successCount: 2, failureCount: 2, utilityScore: 2 / 5 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue(updated),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.incrementFailure("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore is low and there have been enough uses", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is not low enough", async () => {
      const prisma = makePrismaMock();
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
      const skill = makeSkill({ utilityScore: 0.5, successCount: 5, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when there have not been enough uses yet", async () => {
      const prisma = makePrismaMock();
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
      const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility skill and creates the new one inside a transaction", async () => {
      const prisma = makePrismaMock();
      const lowest = makeSkill({ id: "lowest-1", utilityScore: 0.01 });
      const newSkill = makeSkill({ id: "new-1", name: "new-skill" });
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(lowest),
          update: vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() }),
          create: vi.fn().mockResolvedValue(newSkill),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "New description",
        taskCategory: "new-category",
        skillMarkdown: "# New skill",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest-1" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "New description",
          taskCategory: "new-category",
          skillMarkdown: "# New skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "lowest-1" });
    });

    it("throws when there are no active skills to displace", async () => {
      const prisma = makePrismaMock();
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "New description",
          taskCategory: "new-category",
          skillMarkdown: "# New skill",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
