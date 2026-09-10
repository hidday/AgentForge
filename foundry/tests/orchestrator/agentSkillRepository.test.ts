import { describe, it, expect, vi } from "vitest";
import { AgentSkillRepository, type AgentSkill } from "../../src/orchestrator/agentSkillRepository.js";
import { scoreSkillRelevance } from "../../src/utils/similarity.js";
import { env } from "../../src/config/env.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "some-skill",
    description: "does something",
    taskCategory: "general",
    skillMarkdown: "# Some skill\nDo the thing.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      const created = makeSkill();
      const create = vi.fn().mockResolvedValue(created);
      const prisma = { agentSkill: { create } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "some-skill",
        description: "does something",
        taskCategory: "general",
        skillMarkdown: "# Some skill\nDo the thing.",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "some-skill",
          description: "does something",
          taskCategory: "general",
          skillMarkdown: "# Some skill\nDo the thing.",
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
      const skill = makeSkill({ id: "skill-42" });
      const findUnique = vi.fn().mockResolvedValue(skill);
      const prisma = { agentSkill: { findUnique } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("skill-42");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "skill-42" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const prisma = { agentSkill: { findUnique } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("computes the from/to window from around ± the default windowMs (5000)", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = { agentSkill: { findFirst } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-01-01T00:00:10.000Z");

      await repo.findByRepoCategoryNearTime("org/repo", "general", around);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "general",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("computes the from/to window from around ± a custom windowMs", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = { agentSkill: { findFirst } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-01-01T00:01:00.000Z");

      await repo.findByRepoCategoryNearTime("org/repo", "general", around, 1000);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "general",
          createdAt: {
            gte: new Date("2026-01-01T00:00:59.000Z"),
            lte: new Date("2026-01-01T00:01:01.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns the found skill, mapped straight through", async () => {
      const skill = makeSkill();
      const findFirst = vi.fn().mockResolvedValue(skill);
      const prisma = { agentSkill: { findFirst } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findByRepoCategoryNearTime("org/repo", "general", new Date());

      expect(result).toBe(skill);
    });
  });

  describe("findActiveByRepo", () => {
    it("filters by repoSlug and archivedAt null", async () => {
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      const findMany = vi.fn().mockResolvedValue(skills);
      const prisma = { agentSkill: { findMany } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("org/repo");

      expect(findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts active (non-archived) skills for a repo", async () => {
      const count = vi.fn().mockResolvedValue(7);
      const prisma = { agentSkill: { count } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.countActiveByRepo("org/repo");

      expect(count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const skill = makeSkill({ id: "lowest" });
      const findFirst = vi.fn().mockResolvedValue(skill);
      const prisma = { agentSkill: { findFirst } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when there are no active skills", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = { agentSkill: { findFirst } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date via update", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const prisma = { agentSkill: { update } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveById("skill-1");

      expect(update).toHaveBeenCalledTimes(1);
      const call = update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores skills via the real scoreSkillRelevance, sorts descending, and truncates to min(k, MAX_SKILLS_INJECTED)", async () => {
      const query = "refactor the authentication module";
      const skills = [
        makeSkill({
          id: "exact-match",
          taskCategory: "refactor the authentication module",
          name: "auth-refactor",
          description: "refactor the authentication module",
          skillMarkdown: "refactor the authentication module in depth",
        }),
        makeSkill({
          id: "close-match",
          taskCategory: "authentication cleanup",
          name: "auth-cleanup",
          description: "cleans up authentication code",
          skillMarkdown: "cleanup authentication logic and modules",
        }),
        makeSkill({
          id: "medium-match",
          taskCategory: "backend refactor",
          name: "backend-refactor",
          description: "general backend refactor work",
          skillMarkdown: "refactor backend services",
        }),
        makeSkill({
          id: "weak-match",
          taskCategory: "database indexing",
          name: "db-index",
          description: "adds indexes to slow queries",
          skillMarkdown: "add composite indexes for query performance",
        }),
        makeSkill({
          id: "no-match",
          taskCategory: "zzz completely unrelated topic qqq",
          name: "xyz-unrelated",
          description: "totally unrelated to anything else here",
          skillMarkdown: "zzz qqq xyz unrelated content with no overlap whatsoever",
        }),
      ];
      const findMany = vi.fn().mockResolvedValue(skills);
      const prisma = { agentSkill: { findMany } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      // Independently compute expected ranking using the real scoring function,
      // exactly as the repository is expected to (it must not use a different/mocked score).
      const expectedOrder = [...skills]
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

      const k = 5;
      const expectedLength = Math.min(k, env.MAX_SKILLS_INJECTED);
      // Sanity: prove the limit actually truncates something in this test, per instructions.
      expect(expectedLength).toBeLessThan(skills.length);

      const result = await repo.findTopKByRelevance("org/repo", query, k);

      expect(findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(expectedLength);
      expect(result.map((s) => s.id)).toEqual(
        expectedOrder.slice(0, expectedLength).map(({ skill }) => skill.id),
      );
      // The exact-match skill should score highest and thus appear first.
      expect(result[0].id).toBe("exact-match");
    });

    it("also truncates on k when k is smaller than MAX_SKILLS_INJECTED", async () => {
      const query = "some query";
      const skills = [
        makeSkill({ id: "s1", taskCategory: "some query topic" }),
        makeSkill({ id: "s2", taskCategory: "another topic entirely" }),
        makeSkill({ id: "s3", taskCategory: "yet another distinct topic" }),
      ];
      const findMany = vi.fn().mockResolvedValue(skills);
      const prisma = { agentSkill: { findMany } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", query, 1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("s1");
    });

    it("returns an empty array when there are no active skills", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = { agentSkill: { findMany } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("computes utilityScore as successCount / (successCount + failureCount + 1) using concrete numbers", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
      const update = vi.fn().mockImplementation((args) => Promise.resolve({ ...existing, ...args.data }));
      const agentSkill = { findUniqueOrThrow, update };
      const prisma = {
        agentSkill,
        $transaction: vi.fn((cb: (tx: { agentSkill: typeof agentSkill }) => unknown) => cb({ agentSkill })),
      } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementSuccess("skill-1");

      // newSuccessCount = 3, utilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 0.6,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
      expect(result.utilityScore).toBe(0.6);
    });
  });

  describe("incrementFailure", () => {
    it("computes utilityScore as successCount / (successCount + newFailureCount + 1) using concrete numbers", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 4, failureCount: 1 });
      const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
      const update = vi.fn().mockImplementation((args) => Promise.resolve({ ...existing, ...args.data }));
      const agentSkill = { findUniqueOrThrow, update };
      const prisma = {
        agentSkill,
        $transaction: vi.fn((cb: (tx: { agentSkill: typeof agentSkill }) => unknown) => cb({ agentSkill })),
      } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, utilityScore = 4 / (4 + 2 + 1) = 4/7
      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 4 / 7,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
      expect(result.utilityScore).toBeCloseTo(4 / 7);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utilityScore < 0.2 and totalUses >= 5", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const prisma = { agentSkill: { update } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "low-skill", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(update).toHaveBeenCalledWith({
        where: { id: "low-skill" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does NOT archive when utilityScore is exactly 0.2 (boundary, not below threshold)", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const prisma = { agentSkill: { update } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "boundary-skill", utilityScore: 0.2, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });

    it("does NOT archive when totalUses is below 5, even with a low utilityScore", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const prisma = { agentSkill: { update } } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "few-uses-skill", utilityScore: 0.05, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill first, then creates the new one, returning both ids", async () => {
      const lowestUtility = makeSkill({ id: "lowest-1", utilityScore: 0.05 });
      const newSkillRow = makeSkill({ id: "new-1", name: "new-skill" });
      const callOrder: string[] = [];

      const findFirst = vi.fn().mockImplementation(() => {
        callOrder.push("findFirst");
        return Promise.resolve(lowestUtility);
      });
      const update = vi.fn().mockImplementation(() => {
        callOrder.push("update");
        return Promise.resolve({ ...lowestUtility, archivedAt: new Date() });
      });
      const create = vi.fn().mockImplementation(() => {
        callOrder.push("create");
        return Promise.resolve(newSkillRow);
      });
      const agentSkill = { findFirst, update, create };
      const prisma = {
        agentSkill,
        $transaction: vi.fn((cb: (tx: { agentSkill: typeof agentSkill }) => unknown) => cb({ agentSkill })),
      } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "a new skill",
        taskCategory: "general",
        skillMarkdown: "# New skill",
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: "lowest-1" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "a new skill",
          taskCategory: "general",
          skillMarkdown: "# New skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(callOrder).toEqual(["findFirst", "update", "create"]);
      expect(result).toEqual({ newSkill: newSkillRow, displacedSkillId: "lowest-1" });
    });

    it("throws an Error mentioning the repoSlug when no active skill is found to displace", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const update = vi.fn();
      const create = vi.fn();
      const agentSkill = { findFirst, update, create };
      const prisma = {
        agentSkill,
        $transaction: vi.fn((cb: (tx: { agentSkill: typeof agentSkill }) => unknown) => cb({ agentSkill })),
      } as unknown as PrismaClient;
      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.displaceAndCreate("org/empty-repo", {
          name: "new-skill",
          description: "a new skill",
          taskCategory: "general",
          skillMarkdown: "# New skill",
        }),
      ).rejects.toThrow(/org\/empty-repo/);

      expect(update).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });
});
