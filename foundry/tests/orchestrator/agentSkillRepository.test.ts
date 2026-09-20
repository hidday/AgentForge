import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { env } from "../../src/config/env.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "acme/repo",
    name: "auth-middleware",
    description: "Use when adding auth middleware.",
    taskCategory: "auth",
    skillMarkdown: "Use JWT with RS256.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastUsedAt: null,
    archivedAt: null,
  } as unknown as AgentSkill;
}

function makePrisma() {
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
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ agentSkill })),
  };
  return prisma as unknown as PrismaClient & { agentSkill: typeof agentSkill };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument", () => {
    const skill = makeSkill({ id: "s-9", lastUsedAt: new Date("2026-02-02T00:00:00.000Z") });
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: "s-9",
      repoSlug: "acme/repo",
      name: "auth-middleware",
      description: "Use when adding auth middleware.",
      taskCategory: "auth",
      skillMarkdown: "Use JWT with RS256.",
      utilityScore: 0,
      lastUsedAt: new Date("2026-02-02T00:00:00.000Z"),
    });
  });
});

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma);
  });

  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      const created = makeSkill();
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.create({
        repoSlug: "acme/repo",
        name: "auth-middleware",
        description: "desc",
        taskCategory: "auth",
        skillMarkdown: "md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/repo",
          name: "auth-middleware",
          description: "desc",
          taskCategory: "auth",
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
    it("returns the skill when found", async () => {
      const skill = makeSkill();
      prisma.agentSkill.findUnique.mockResolvedValue(skill);
      const result = await repo.findById("skill-1");
      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries a time window around the given date with default windowMs", async () => {
      const around = new Date("2026-03-01T12:00:00.000Z");
      const found = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(found);

      const result = await repo.findByRepoCategoryNearTime("acme/repo", "auth", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/repo",
          taskCategory: "auth",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(found);
    });

    it("honors a custom windowMs", async () => {
      const around = new Date("2026-03-01T12:00:00.000Z");
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      const result = await repo.findByRepoCategoryNearTime("acme/repo", "auth", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/repo",
          taskCategory: "auth",
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
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findActiveByRepo("acme/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const result = await repo.findActiveByRepo("acme/repo");
      expect(result).toEqual([]);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the active skill count", async () => {
      prisma.agentSkill.count.mockResolvedValue(7);
      const result = await repo.countActiveByRepo("acme/repo");
      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("returns the lowest-utility active skill", async () => {
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const result = await repo.findLowestUtilityActive("acme/repo");
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when no active skills exist", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const result = await repo.findLowestUtilityActive("acme/repo");
      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date on the target skill", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      await repo.archiveById("skill-1");
      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0] as {
        where: { id: string };
        data: { archivedAt: Date };
      };
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("returns an empty array when the repo has no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const result = await repo.findTopKByRelevance("acme/repo", "auth middleware", 3);
      expect(result).toEqual([]);
    });

    it("ranks skills by relevance score, descending", async () => {
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "auth middleware",
        name: "auth-middleware",
        description: "Adds JWT auth middleware to Express routes.",
        skillMarkdown: "Use JWT auth middleware with RS256 tokens for stateless authentication.",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "database migrations",
        name: "db-migration",
        description: "Runs schema migrations safely.",
        skillMarkdown: "Always wrap migrations in a transaction and take a backup first.",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);

      const result = await repo.findTopKByRelevance(
        "acme/repo",
        "auth middleware JWT authentication",
        2,
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("relevant");
      expect(result[1].id).toBe("irrelevant");
    });

    it("caps the result size at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const skills = Array.from({ length: env.MAX_SKILLS_INJECTED + 5 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, skillMarkdown: `content ${i} auth middleware` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance(
        "acme/repo",
        "auth middleware",
        env.MAX_SKILLS_INJECTED + 5,
      );

      expect(result.length).toBe(env.MAX_SKILLS_INJECTED);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
      prisma.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0] as {
        where: { id: string };
        data: { successCount: number; utilityScore: number; lastUsedAt: Date };
      };
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.successCount).toBe(3);
      // 3 successes / (3 + 1 failures + 1) = 0.6
      expect(call.data.utilityScore).toBeCloseTo(0.6);
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toBe(updated);
    });

    it("propagates the error when the skill does not exist", async () => {
      prisma.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("Record not found"));
      await expect(repo.incrementSuccess("missing")).rejects.toThrow("Record not found");
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore", async () => {
      const existing = makeSkill({ successCount: 3, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockResolvedValue(makeSkill());

      await repo.incrementFailure("skill-1");

      const call = prisma.agentSkill.update.mock.calls[0][0] as {
        data: { failureCount: number; utilityScore: number };
      };
      expect(call.data.failureCount).toBe(2);
      // 3 successes / (3 + 2 failures + 1) = 0.5
      expect(call.data.utilityScore).toBeCloseTo(0.5);
    });

    it("propagates the error when the skill does not exist", async () => {
      prisma.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("Record not found"));
      await expect(repo.incrementFailure("missing")).rejects.toThrow("Record not found");
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utilityScore is below 0.2 and totalUses is at least 5", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "low", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is exactly at the 0.2 boundary", async () => {
      const skill = makeSkill({ id: "boundary", utilityScore: 0.2, successCount: 1, failureCount: 4 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when totalUses is below 5, even with low utility", async () => {
      const skill = makeSkill({ id: "fewuses", utilityScore: 0.05, successCount: 1, failureCount: 2 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("archives right at the totalUses boundary of 5", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "exactly5", utilityScore: 0.19, successCount: 1, failureCount: 4 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "exactly5" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility skill and creates the new one", async () => {
      const lowest = makeSkill({ id: "lowest-util" });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ id: "lowest-util", archivedAt: new Date() }));
      const created = makeSkill({ id: "new-skill" });
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("acme/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "auth",
        skillMarkdown: "md",
      });

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest-util" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "auth",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "lowest-util" });
    });

    it("throws when there are no active skills to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("acme/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "auth",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo acme/repo to displace");

      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
