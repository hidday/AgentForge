import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import { scoreSkillRelevance } from "../../src/utils/similarity.js";
import { env } from "../../src/config/env.js";

vi.mock("../../src/utils/similarity.js", () => ({
  scoreSkillRelevance: vi.fn(),
}));

vi.mock("../../src/config/env.js", () => ({
  env: { MAX_SKILLS_INJECTED: 3 },
}));

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "some-skill",
    description: "A skill",
    taskCategory: "bugfix",
    skillMarkdown: "# Some skill\nDo the thing.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function buildPrismaMock() {
  const tx = {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };
  const prisma = {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
  };
  return { prisma, tx };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument with the expected fields", () => {
    const skill = makeSkill({
      id: "skill-42",
      repoSlug: "org/repo",
      name: "my-skill",
      description: "desc",
      taskCategory: "feature",
      skillMarkdown: "md",
      utilityScore: 0.5,
    });

    const doc = mapAgentSkillToDocument(skill);

    expect(doc).toEqual({
      id: "skill-42",
      repoSlug: "org/repo",
      name: "my-skill",
      description: "desc",
      taskCategory: "feature",
      skillMarkdown: "md",
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  beforeEach(() => {
    vi.mocked(scoreSkillRelevance).mockReset();
    env.MAX_SKILLS_INJECTED = 3;
  });

  describe("create", () => {
    it("creates a new skill with zeroed counters and utility score", async () => {
      const { prisma } = buildPrismaMock();
      const created = makeSkill();
      prisma.agentSkill.create.mockResolvedValue(created);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "new-skill",
        description: "desc",
        taskCategory: "bugfix",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "bugfix",
          skillMarkdown: "# md",
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
      const { prisma } = buildPrismaMock();
      const skill = makeSkill({ id: "skill-7" });
      prisma.agentSkill.findUnique.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("skill-7");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-7" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      const { prisma } = buildPrismaMock();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window around the given time", async () => {
      const { prisma } = buildPrismaMock();
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-01-01T00:00:10.000Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "bugfix", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "bugfix",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("honors a custom windowMs", async () => {
      const { prisma } = buildPrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-01-01T00:00:10.000Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "bugfix", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "bugfix",
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
    it("queries only non-archived skills for the repo", async () => {
      const { prisma } = buildPrismaMock();
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts only non-archived skills for the repo", async () => {
      const { prisma } = buildPrismaMock();
      prisma.agentSkill.count.mockResolvedValue(4);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const { prisma } = buildPrismaMock();
      const skill = makeSkill({ id: "low-util" });
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when there are no active skills", async () => {
      const { prisma } = buildPrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time", async () => {
      const { prisma } = buildPrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
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
    it("scores, sorts descending, and slices to k when k <= MAX_SKILLS_INJECTED", async () => {
      const { prisma } = buildPrismaMock();
      const skillA = makeSkill({ id: "a", name: "alpha" });
      const skillB = makeSkill({ id: "b", name: "beta" });
      const skillC = makeSkill({ id: "c", name: "gamma" });
      prisma.agentSkill.findMany.mockResolvedValue([skillA, skillB, skillC]);

      vi.mocked(scoreSkillRelevance).mockImplementation((skill) => {
        const scores: Record<string, number> = { alpha: 0.2, beta: 0.9, gamma: 0.5 };
        return scores[skill.name as string] ?? 0;
      });

      const repo = new AgentSkillRepository(prisma as never);
      const result = await repo.findTopKByRelevance("org/repo", "fix the bug", 2);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(scoreSkillRelevance).toHaveBeenCalledTimes(3);
      expect(result.map((d) => d.id)).toEqual(["b", "c"]);
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const { prisma } = buildPrismaMock();
      env.MAX_SKILLS_INJECTED = 2;
      const skills = [
        makeSkill({ id: "a", name: "alpha" }),
        makeSkill({ id: "b", name: "beta" }),
        makeSkill({ id: "c", name: "gamma" }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      vi.mocked(scoreSkillRelevance).mockImplementation((skill) => {
        const scores: Record<string, number> = { alpha: 0.9, beta: 0.5, gamma: 0.1 };
        return scores[skill.name as string] ?? 0;
      });

      const repo = new AgentSkillRepository(prisma as never);
      const result = await repo.findTopKByRelevance("org/repo", "query", 10);

      expect(result).toHaveLength(2);
      expect(result.map((d) => d.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when there are no active skills", async () => {
      const { prisma } = buildPrismaMock();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("org/repo", "query", 3);

      expect(result).toEqual([]);
      expect(scoreSkillRelevance).not.toHaveBeenCalled();
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const { prisma, tx } = buildPrismaMock();
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1 });
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      tx.agentSkill.update.mockResolvedValue(updated);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newSuccessCount = 3, newUtilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          successCount: 3,
          utilityScore: 0.6,
        }),
      });
      const call = tx.agentSkill.update.mock.calls[0][0];
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toBe(updated);
    });

    it("propagates the error when the skill does not exist", async () => {
      const { prisma, tx } = buildPrismaMock();
      const notFound = new Error("No AgentSkill found");
      tx.agentSkill.findUniqueOrThrow.mockRejectedValue(notFound);
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.incrementSuccess("missing")).rejects.toBe(notFound);
      expect(tx.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const { prisma, tx } = buildPrismaMock();
      const existing = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 3, failureCount: 2 });
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      tx.agentSkill.update.mockResolvedValue(updated);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // newFailureCount = 2, newUtilityScore = 3 / (3 + 2 + 1) = 0.5
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          failureCount: 2,
          utilityScore: 0.5,
        }),
      });
      expect(result).toBe(updated);
    });

    it("propagates the error when the skill does not exist", async () => {
      const { prisma, tx } = buildPrismaMock();
      const notFound = new Error("No AgentSkill found");
      tx.agentSkill.findUniqueOrThrow.mockRejectedValue(notFound);
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.incrementFailure("missing")).rejects.toBe(notFound);
      expect(tx.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore < 0.2 AND totalUses >= 5 (boundary: exactly 5 uses)", async () => {
      const { prisma } = buildPrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "low", utilityScore: 0.19, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is at or above the 0.2 threshold", async () => {
      const { prisma } = buildPrismaMock();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "ok", utilityScore: 0.2, successCount: 2, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when totalUses is below 5, even with low utility", async () => {
      const { prisma } = buildPrismaMock();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "new", utilityScore: 0.0, successCount: 1, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("archives when both totalUses and low utility exceed the boundary", async () => {
      const { prisma } = buildPrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "bad", utilityScore: 0.05, successCount: 1, failureCount: 9 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "bad" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new skill inside a transaction", async () => {
      const { prisma, tx } = buildPrismaMock();
      const lowestUtility = makeSkill({ id: "to-displace", utilityScore: 0.01 });
      const createdSkill = makeSkill({ id: "new-skill" });
      tx.agentSkill.findFirst.mockResolvedValue(lowestUtility);
      tx.agentSkill.update.mockResolvedValue({ ...lowestUtility, archivedAt: new Date() });
      tx.agentSkill.create.mockResolvedValue(createdSkill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "bugfix",
        skillMarkdown: "md",
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "to-displace" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "bugfix",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: createdSkill, displacedSkillId: "to-displace" });
    });

    it("throws and creates nothing when there is no active skill to displace", async () => {
      const { prisma, tx } = buildPrismaMock();
      tx.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "bugfix",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
