import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
} from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "Deploy pipeline",
    description: "Describes the deploy pipeline",
    taskCategory: "deployment",
    skillMarkdown: "# Deploy\nSteps to deploy",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    lastUsedAt: new Date("2024-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  };
}

function makeMockPrisma() {
  const tx = {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    __tx: tx,
  };
}

describe("mapAgentSkillToDocument", () => {
  it("maps a skill row to a SkillDocument with the same field values", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill as never);
    expect(doc).toEqual({
      id: "skill-1",
      repoSlug: "org/repo",
      name: "Deploy pipeline",
      description: "Describes the deploy pipeline",
      taskCategory: "deployment",
      skillMarkdown: "# Deploy\nSteps to deploy",
      utilityScore: 0,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      const mockPrisma = makeMockPrisma();
      const created = makeSkill();
      mockPrisma.agentSkill.create.mockResolvedValue(created);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.create({
        repoSlug: "org/repo",
        name: "Deploy pipeline",
        description: "Describes the deploy pipeline",
        taskCategory: "deployment",
        skillMarkdown: "# Deploy\nSteps to deploy",
      });

      expect(mockPrisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "Deploy pipeline",
          description: "Describes the deploy pipeline",
          taskCategory: "deployment",
          skillMarkdown: "# Deploy\nSteps to deploy",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual(created);
    });

    it("propagates errors from the underlying prisma call", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.agentSkill.create.mockRejectedValue(new Error("insert failed"));

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      await expect(
        repo.create({
          repoSlug: "org/repo",
          name: "n",
          description: "d",
          taskCategory: "c",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const mockPrisma = makeMockPrisma();
      const skill = makeSkill();
      mockPrisma.agentSkill.findUnique.mockResolvedValue(skill);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findById("skill-1");

      expect(mockPrisma.agentSkill.findUnique).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(result).toEqual(skill);
    });

    it("returns null when not found", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.agentSkill.findUnique.mockResolvedValue(null);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("builds a time window using the default windowMs and queries by repo/category", async () => {
      const mockPrisma = makeMockPrisma();
      const skill = makeSkill();
      mockPrisma.agentSkill.findFirst.mockResolvedValue(skill);
      const around = new Date("2024-06-01T12:00:00.000Z");

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findByRepoCategoryNearTime("org/repo", "deployment", around);

      expect(mockPrisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deployment",
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
      const mockPrisma = makeMockPrisma();
      mockPrisma.agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2024-06-01T12:00:00.000Z");

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findByRepoCategoryNearTime(
        "org/repo",
        "deployment",
        around,
        10_000,
      );

      expect(mockPrisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date(around.getTime() - 10_000),
            lte: new Date(around.getTime() + 10_000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries for non-archived skills in the repo", async () => {
      const mockPrisma = makeMockPrisma();
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      mockPrisma.agentSkill.findMany.mockResolvedValue(skills);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findActiveByRepo("org/repo");

      expect(mockPrisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toEqual(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the count of non-archived skills", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.agentSkill.count.mockResolvedValue(3);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.countActiveByRepo("org/repo");

      expect(mockPrisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(3);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      const mockPrisma = makeMockPrisma();
      const skill = makeSkill({ id: "lowest" });
      mockPrisma.agentSkill.findFirst.mockResolvedValue(skill);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findLowestUtilityActive("org/repo");

      expect(mockPrisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toEqual(skill);
    });

    it("returns null when there are no active skills", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.agentSkill.findFirst.mockResolvedValue(null);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.agentSkill.update.mockResolvedValue(makeSkill());

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      await repo.archiveById("skill-1");

      expect(mockPrisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = mockPrisma.agentSkill.update.mock.calls[0]?.[0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });

    it("propagates errors from the underlying prisma call", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.agentSkill.update.mockRejectedValue(new Error("not found"));

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      await expect(repo.archiveById("missing")).rejects.toThrow("not found");
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance score and returns the top k as documents", async () => {
      const mockPrisma = makeMockPrisma();
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "deployment",
        skillMarkdown: "deployment pipeline steps for deploying the service",
        name: "deploy",
        description: "deploy things",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "unrelated-zzz",
        skillMarkdown: "nothing to do with the query at all, totally different topic",
        name: "other",
        description: "other stuff",
      });
      mockPrisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findTopKByRelevance("org/repo", "deployment pipeline", 1);

      expect(mockPrisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("relevant");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const mockPrisma = makeMockPrisma();
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: `category-${i}` }),
      );
      mockPrisma.agentSkill.findMany.mockResolvedValue(skills);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      // MAX_SKILLS_INJECTED defaults to 3 per env schema; requesting far more
      // than that must still be capped.
      const result = await repo.findTopKByRelevance("org/repo", "category", 100);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.agentSkill.findMany.mockResolvedValue([]);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.findTopKByRelevance("org/repo", "anything", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
      const mockPrisma = makeMockPrisma();
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      mockPrisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1 });
      mockPrisma.__tx.agentSkill.update.mockResolvedValue(updated);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.incrementSuccess("skill-1");

      expect(mockPrisma.__tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      // newSuccessCount = 3, utilityScore = 3 / (3 + 1 + 1) = 0.6
      const updateCall = mockPrisma.__tx.agentSkill.update.mock.calls[0]?.[0];
      expect(updateCall.where).toEqual({ id: "skill-1" });
      expect(updateCall.data.successCount).toBe(3);
      expect(updateCall.data.utilityScore).toBeCloseTo(0.6);
      expect(updateCall.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toEqual(updated);
    });

    it("propagates errors when the skill does not exist", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.__tx.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("not found"));

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      await expect(repo.incrementSuccess("missing")).rejects.toThrow("not found");
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const mockPrisma = makeMockPrisma();
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      mockPrisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ id: "skill-1", successCount: 2, failureCount: 2 });
      mockPrisma.__tx.agentSkill.update.mockResolvedValue(updated);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, utilityScore = 2 / (2 + 2 + 1) = 0.4
      const updateCall = mockPrisma.__tx.agentSkill.update.mock.calls[0]?.[0];
      expect(updateCall.data.failureCount).toBe(2);
      expect(updateCall.data.utilityScore).toBeCloseTo(0.4);
      expect(result).toEqual(updated);
    });

    it("propagates errors when the skill does not exist", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.__tx.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("not found"));

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      await expect(repo.incrementFailure("missing")).rejects.toThrow("not found");
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore is below 0.2 and total uses reach 5", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);

      const skill = makeSkill({ id: "low", utilityScore: 0.1, successCount: 1, failureCount: 4 });
      await repo.archiveIfLowUtility(skill as never);

      expect(mockPrisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is exactly at the 0.2 boundary", async () => {
      const mockPrisma = makeMockPrisma();
      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);

      const skill = makeSkill({
        id: "boundary",
        utilityScore: 0.2,
        successCount: 1,
        failureCount: 4,
      });
      await repo.archiveIfLowUtility(skill as never);

      expect(mockPrisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses are below the 5-use threshold, even with low utility", async () => {
      const mockPrisma = makeMockPrisma();
      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);

      const skill = makeSkill({
        id: "too-new",
        utilityScore: 0.05,
        successCount: 1,
        failureCount: 3,
      });
      await repo.archiveIfLowUtility(skill as never);

      expect(mockPrisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("archives exactly at the 5-use boundary when utility is low", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);

      const skill = makeSkill({
        id: "exactly-five",
        utilityScore: 0.1,
        successCount: 2,
        failureCount: 3,
      });
      await repo.archiveIfLowUtility(skill as never);

      expect(mockPrisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "exactly-five" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one inside a transaction", async () => {
      const mockPrisma = makeMockPrisma();
      const lowest = makeSkill({ id: "lowest", utilityScore: 0.01 });
      mockPrisma.__tx.agentSkill.findFirst.mockResolvedValue(lowest);
      const newSkill = makeSkill({ id: "new-skill", name: "New skill" });
      mockPrisma.__tx.agentSkill.create.mockResolvedValue(newSkill);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      const result = await repo.displaceAndCreate("org/repo", {
        name: "New skill",
        description: "desc",
        taskCategory: "cat",
        skillMarkdown: "md",
      });

      expect(mockPrisma.__tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(mockPrisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(mockPrisma.__tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "New skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      const mockPrisma = makeMockPrisma();
      mockPrisma.__tx.agentSkill.findFirst.mockResolvedValue(null);

      const repo = new AgentSkillRepository(mockPrisma as unknown as PrismaClient);
      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "New skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(mockPrisma.__tx.agentSkill.update).not.toHaveBeenCalled();
      expect(mockPrisma.__tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
