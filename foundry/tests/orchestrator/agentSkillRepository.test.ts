import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "deploy-service",
    description: "How to deploy the service",
    taskCategory: "deployment",
    skillMarkdown: "# Deploy\nRun the deploy script.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      ...overrides,
    },
    $transaction: vi.fn(),
  } as unknown as PrismaClient;
}

describe("mapAgentSkillToDocument", () => {
  it("projects an AgentSkill row onto a SkillDocument", () => {
    const skill = makeSkill({ id: "s1", repoSlug: "org/repo", utilityScore: 0.5 });
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: "s1",
      repoSlug: "org/repo",
      name: skill.name,
      description: skill.description,
      taskCategory: skill.taskCategory,
      skillMarkdown: skill.skillMarkdown,
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates with zeroed counters/score and returns the raw prisma row", async () => {
      const created = makeSkill();
      const create = vi.fn().mockResolvedValue(created);
      const prisma = makePrisma({ create });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "deploy-service",
        description: "How to deploy the service",
        taskCategory: "deployment",
        skillMarkdown: "# Deploy\nRun the deploy script.",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "deploy-service",
          description: "How to deploy the service",
          taskCategory: "deployment",
          skillMarkdown: "# Deploy\nRun the deploy script.",
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
      const skill = makeSkill({ id: "s42" });
      const findUnique = vi.fn().mockResolvedValue(skill);
      const prisma = makePrisma({ findUnique });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("s42");
      expect(findUnique).toHaveBeenCalledWith({ where: { id: "s42" } });
      expect(result?.id).toBe("s42");
    });

    it("returns null when not found", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findUnique });
      const repo = new AgentSkillRepository(prisma);

      expect(await repo.findById("missing")).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window around the given time", async () => {
      const findFirst = vi.fn().mockResolvedValue(makeSkill());
      const prisma = makePrisma({ findFirst });
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-01-01T00:00:10.000Z");

      await repo.findByRepoCategoryNearTime("org/repo", "deployment", around);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("honors a custom windowMs", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-01-01T00:00:10.000Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "deployment", around, 1000);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date("2026-01-01T00:00:09.000Z"),
            lte: new Date("2026-01-01T00:00:11.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("filters by repoSlug and archivedAt: null", async () => {
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      const findMany = vi.fn().mockResolvedValue(skills);
      const prisma = makePrisma({ findMany });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("org/repo");

      expect(findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts active skills for a repo", async () => {
      const count = vi.fn().mockResolvedValue(4);
      const prisma = makePrisma({ count });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.countActiveByRepo("org/repo");

      expect(count).toHaveBeenCalledWith({ where: { repoSlug: "org/repo", archivedAt: null } });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const skill = makeSkill({ id: "low" });
      const findFirst = vi.fn().mockResolvedValue(skill);
      const prisma = makePrisma({ findFirst });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.id).toBe("low");
    });

    it("returns null when there are no active skills", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findFirst });
      const repo = new AgentSkillRepository(prisma);

      expect(await repo.findLowestUtilityActive("org/repo")).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date via update", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const prisma = makePrisma({ update });
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveById("s1");

      expect(update).toHaveBeenCalledTimes(1);
      const call = update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "s1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills by relevance, sorts descending, and caps at min(k, MAX_SKILLS_INJECTED)", async () => {
      const skills = [
        makeSkill({
          id: "irrelevant",
          taskCategory: "unrelated-topic",
          skillMarkdown: "totally different content about gardening",
          name: "gardening",
          description: "how to garden",
        }),
        makeSkill({
          id: "exact-match",
          taskCategory: "deployment",
          skillMarkdown: "# Deploy the service to production",
          name: "deploy-service",
          description: "deploy the service",
        }),
        makeSkill({
          id: "partial-match",
          taskCategory: "deployment-rollback",
          skillMarkdown: "# Rollback a deployment",
          name: "rollback",
          description: "rollback",
        }),
      ];
      const findMany = vi.fn().mockResolvedValue(skills);
      const prisma = makePrisma({ findMany });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "deploy the service", 10);

      expect(findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      // capped at env.MAX_SKILLS_INJECTED (default 3), and the exact match should rank first
      expect(result.length).toBeLessThanOrEqual(3);
      expect(result[0].id).toBe("exact-match");
      // ordering must be non-increasing relevance: irrelevant skill should not outrank exact match
      const ids = result.map((r) => r.id);
      expect(ids.indexOf("exact-match")).toBeLessThan(
        ids.indexOf("irrelevant") === -1 ? Infinity : ids.indexOf("irrelevant"),
      );
    });

    it("returns SkillDocument shapes, not raw AgentSkill rows", async () => {
      const skills = [makeSkill({ id: "s1" })];
      const findMany = vi.fn().mockResolvedValue(skills);
      const prisma = makePrisma({ findMany });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "deploy", 5);

      expect(result[0]).toEqual({
        id: "s1",
        repoSlug: "org/repo",
        name: skills[0].name,
        description: skills[0].description,
        taskCategory: skills[0].taskCategory,
        skillMarkdown: skills[0].skillMarkdown,
        utilityScore: skills[0].utilityScore,
        lastUsedAt: skills[0].lastUsedAt,
      });
    });

    it("respects a k smaller than the number of active skills", async () => {
      const skills = [
        makeSkill({ id: "a", taskCategory: "deployment" }),
        makeSkill({ id: "b", taskCategory: "deployment" }),
      ];
      const findMany = vi.fn().mockResolvedValue(skills);
      const prisma = makePrisma({ findMany });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "deployment", 1);
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when there are no active skills", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 5);
      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ id: "s1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "s1", successCount: 3, failureCount: 1 });
      const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
      const update = vi.fn().mockResolvedValue(updated);
      const tx = { agentSkill: { findUniqueOrThrow, update } };
      const $transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));
      const prisma = makePrisma({ $transaction }) as unknown as PrismaClient & {
        $transaction: typeof $transaction;
      };
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementSuccess("s1");

      expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "s1" } });
      // newSuccessCount = 3; newUtilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(update).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: expect.objectContaining({
          successCount: 3,
          utilityScore: 0.6,
        }),
      });
      const updateData = update.mock.calls[0][0].data;
      expect(updateData.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toBe(updated);
    });

    it("propagates a not-found error from findUniqueOrThrow", async () => {
      const notFoundErr = new Error("No AgentSkill found");
      const findUniqueOrThrow = vi.fn().mockRejectedValue(notFoundErr);
      const tx = { agentSkill: { findUniqueOrThrow, update: vi.fn() } };
      const $transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));
      const prisma = makePrisma({ $transaction }) as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      await expect(repo.incrementSuccess("missing")).rejects.toThrow("No AgentSkill found");
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore using the successCount ratio", async () => {
      const existing = makeSkill({ id: "s1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "s1", successCount: 2, failureCount: 2 });
      const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
      const update = vi.fn().mockResolvedValue(updated);
      const tx = { agentSkill: { findUniqueOrThrow, update } };
      const $transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));
      const prisma = makePrisma({ $transaction }) as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementFailure("s1");

      // newFailureCount = 2; newUtilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(update).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: expect.objectContaining({
          failureCount: 2,
          utilityScore: 0.4,
        }),
      });
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utilityScore < 0.2 and total uses >= 5", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const prisma = makePrisma({ update });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "low-util", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(update).toHaveBeenCalledWith({
        where: { id: "low-util" },
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      });
    });

    it("does not archive when utilityScore is high even with many uses", async () => {
      const update = vi.fn();
      const prisma = makePrisma({ update });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ utilityScore: 0.9, successCount: 9, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });

    it("does not archive when utilityScore is low but total uses are below the threshold", async () => {
      const update = vi.fn();
      const prisma = makePrisma({ update });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });

    it("treats the boundary (utilityScore exactly 0.2) as not low", async () => {
      const update = vi.fn();
      const prisma = makePrisma({ update });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ utilityScore: 0.2, successCount: 5, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one inside a transaction", async () => {
      const lowestUtility = makeSkill({ id: "to-archive", utilityScore: 0.01 });
      const newSkillRow = makeSkill({ id: "new-skill" });
      const findFirst = vi.fn().mockResolvedValue(lowestUtility);
      const update = vi.fn().mockResolvedValue({ ...lowestUtility, archivedAt: new Date() });
      const create = vi.fn().mockResolvedValue(newSkillRow);
      const tx = { agentSkill: { findFirst, update, create } };
      const $transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));
      const prisma = makePrisma({ $transaction }) as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "cat",
        skillMarkdown: "md",
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: "to-archive" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: newSkillRow, displacedSkillId: "to-archive" });
    });

    it("throws when there is no active skill to displace", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const update = vi.fn();
      const create = vi.fn();
      const tx = { agentSkill: { findFirst, update, create } };
      const $transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));
      const prisma = makePrisma({ $transaction }) as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.displaceAndCreate("org/empty-repo", {
          name: "x",
          description: "x",
          taskCategory: "x",
          skillMarkdown: "x",
        }),
      ).rejects.toThrow("No active skills found for repo org/empty-repo to displace");

      expect(update).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });
});
