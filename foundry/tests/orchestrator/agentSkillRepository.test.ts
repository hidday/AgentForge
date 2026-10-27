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
    repoSlug: "acme/widgets",
    name: "retry-flaky-tests",
    description: "Retries flaky integration tests",
    taskCategory: "testing",
    skillMarkdown: "# Retry flaky tests\nSome markdown body.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      ...overrides,
    },
  };
}

function makePrisma(overrides: Record<string, unknown> = {}, txOverrides: Record<string, unknown> = {}) {
  const tx = makeTx(txOverrides);
  const prisma = {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      ...overrides,
    },
    $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
  } as unknown as PrismaClient & { $transaction: ReturnType<typeof vi.fn> };
  return { prisma, tx };
}

describe("mapAgentSkillToDocument / toSkillDocument", () => {
  it("maps an AgentSkill row to the SkillDocument shape", () => {
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
    it("creates a skill with zeroed counters/utility and maps the resulting row", async () => {
      const row = makeSkill();
      const create = vi.fn().mockResolvedValue(row);
      const { prisma } = makePrisma({ create });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.create({
        repoSlug: "acme/widgets",
        name: "retry-flaky-tests",
        description: "Retries flaky integration tests",
        taskCategory: "testing",
        skillMarkdown: "# Retry flaky tests",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "retry-flaky-tests",
          description: "Retries flaky integration tests",
          taskCategory: "testing",
          skillMarkdown: "# Retry flaky tests",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toBe(row);
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const row = makeSkill();
      const findUnique = vi.fn().mockResolvedValue(row);
      const { prisma } = makePrisma({ findUnique });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("skill-1");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(row);
    });

    it("returns null when not found", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const { prisma } = makePrisma({ findUnique });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries with a time window around the given date and a default window of 5000ms", async () => {
      const row = makeSkill();
      const findFirst = vi.fn().mockResolvedValue(row);
      const { prisma } = makePrisma({ findFirst });
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-02-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("acme/widgets", "testing", around);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "testing",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(row);
    });

    it("honors a custom windowMs", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const { prisma } = makePrisma({ findFirst });
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-02-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("acme/widgets", "testing", around, 1000);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
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
    it("queries only non-archived skills for the repo", async () => {
      const rows = [makeSkill({ id: "s1" }), makeSkill({ id: "s2" })];
      const findMany = vi.fn().mockResolvedValue(rows);
      const { prisma } = makePrisma({ findMany });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("acme/widgets");

      expect(findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toBe(rows);
    });

    it("returns an empty array when the repo has no active skills", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const { prisma } = makePrisma({ findMany });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("acme/widgets");

      expect(result).toEqual([]);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      const count = vi.fn().mockResolvedValue(7);
      const { prisma } = makePrisma({ count });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.countActiveByRepo("acme/widgets");

      expect(count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toBe(7);
    });

    it("returns 0 when there are no active skills", async () => {
      const count = vi.fn().mockResolvedValue(0);
      const { prisma } = makePrisma({ count });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.countActiveByRepo("acme/widgets");

      expect(result).toBe(0);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("queries non-archived skills ordered by utilityScore asc, then lastUsedAt asc", async () => {
      const row = makeSkill({ utilityScore: 0.1 });
      const findFirst = vi.fn().mockResolvedValue(row);
      const { prisma } = makePrisma({ findFirst });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("acme/widgets");

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(row);
    });

    it("returns null when there are no active skills", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const { prisma } = makePrisma({ findFirst });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("acme/widgets");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date on the targeted skill", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const { prisma } = makePrisma({ update });
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveById("skill-1");

      expect(update).toHaveBeenCalledTimes(1);
      const callArg = update.mock.calls[0][0] as { where: { id: string }; data: { archivedAt: Date } };
      expect(callArg.where).toEqual({ id: "skill-1" });
      expect(callArg.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query, descending, capped at env.MAX_SKILLS_INJECTED", async () => {
      const query = "retry network timeouts";
      const high = makeSkill({ id: "high", taskCategory: query, skillMarkdown: "unrelated body text" });
      const med = makeSkill({
        id: "med",
        taskCategory: "retry timeouts for background jobs",
        skillMarkdown: "unrelated body text",
      });
      const low = makeSkill({
        id: "low",
        taskCategory: "qqqqqqqqqqqqqqqqqqqq",
        skillMarkdown: "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
        name: null,
        description: null,
      });
      const low2 = makeSkill({
        id: "low2",
        taskCategory: "zzzzzzzzzzzzzzzzzzzz",
        skillMarkdown: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        name: null,
        description: null,
      });
      const findMany = vi.fn().mockResolvedValue([high, med, low, low2]);
      const { prisma } = makePrisma({ findMany });
      const repo = new AgentSkillRepository(prisma);

      // k (10) exceeds both the number of skills and env.MAX_SKILLS_INJECTED (default 3),
      // so the result must be capped by the env limit, not by k or by skill count.
      const result = await repo.findTopKByRelevance("acme/widgets", query, 10);

      expect(findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toHaveLength(3);
      expect(result.map((d) => d.id)).toEqual(["high", "med", "low"]);
      expect(result[0]).toEqual({
        id: "high",
        repoSlug: "acme/widgets",
        name: high.name,
        description: high.description,
        taskCategory: high.taskCategory,
        skillMarkdown: high.skillMarkdown,
        utilityScore: high.utilityScore,
        lastUsedAt: high.lastUsedAt,
      });
    });

    it("limits results to k when k is smaller than env.MAX_SKILLS_INJECTED", async () => {
      const query = "retry network timeouts";
      const high = makeSkill({ id: "high", taskCategory: query });
      const low = makeSkill({ id: "low", taskCategory: "qqqqqqqqqqqqqqqqqqqq", name: null, description: null });
      const findMany = vi.fn().mockResolvedValue([high, low]);
      const { prisma } = makePrisma({ findMany });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("acme/widgets", query, 1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("high");
    });

    it("returns an empty array when the repo has no active skills", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const { prisma } = makePrisma({ findMany });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("acme/widgets", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore within a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 3, utilityScore: 0.6 });
      const { prisma, tx } = makePrisma();
      (tx.agentSkill.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
      (tx.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newSuccessCount = 3; newUtilityScore = 3 / (3 + 1 + 1) = 0.6
      const updateArg = (tx.agentSkill.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        where: { id: string };
        data: { successCount: number; utilityScore: number; lastUsedAt: Date };
      };
      expect(updateArg.where).toEqual({ id: "skill-1" });
      expect(updateArg.data.successCount).toBe(3);
      expect(updateArg.data.utilityScore).toBeCloseTo(0.6);
      expect(updateArg.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toBe(updated);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore within a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", failureCount: 2, utilityScore: 0.4 });
      const { prisma, tx } = makePrisma();
      (tx.agentSkill.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
      (tx.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2; newUtilityScore = 2 / (2 + 2 + 1) = 0.4
      const updateArg = (tx.agentSkill.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: { failureCount: number; utilityScore: number; lastUsedAt: Date };
      };
      expect(updateArg.data.failureCount).toBe(2);
      expect(updateArg.data.utilityScore).toBeCloseTo(0.4);
      expect(updateArg.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore is below 0.2 and totalUses >= 5", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const { prisma } = makePrisma({ update });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is exactly 0.2 (boundary, not below)", async () => {
      const update = vi.fn();
      const { prisma } = makePrisma({ update });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.2, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });

    it("does not archive when totalUses is below 5, even with low utility", async () => {
      const update = vi.fn();
      const { prisma } = makePrisma({ update });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.05, successCount: 1, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one within a transaction", async () => {
      const lowestUtility = makeSkill({ id: "lowest", utilityScore: 0.01 });
      const newSkillRow = makeSkill({ id: "new-skill", name: "new-name" });
      const { prisma, tx } = makePrisma();
      (tx.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(lowestUtility);
      (tx.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...lowestUtility,
        archivedAt: new Date(),
      });
      (tx.agentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue(newSkillRow);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.displaceAndCreate("acme/widgets", {
        name: "new-name",
        description: "new description",
        taskCategory: "testing",
        skillMarkdown: "# New skill",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "new-name",
          description: "new description",
          taskCategory: "testing",
          skillMarkdown: "# New skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: newSkillRow, displacedSkillId: "lowest" });
    });

    it("throws when there are no active skills to displace", async () => {
      const { prisma, tx } = makePrisma();
      (tx.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.displaceAndCreate("acme/widgets", {
          name: "new-name",
          description: "new description",
          taskCategory: "testing",
          skillMarkdown: "# New skill",
        }),
      ).rejects.toThrow("No active skills found for repo acme/widgets to displace");

      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
