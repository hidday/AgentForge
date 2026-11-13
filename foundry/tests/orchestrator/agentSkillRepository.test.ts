import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import { env } from "../../src/config/env.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "auth-middleware",
    description: "Sets up JWT auth middleware",
    taskCategory: "auth",
    skillMarkdown: "# Auth middleware\nUse JWT tokens for authentication setup.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function makePrisma() {
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
    $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    __tx: tx,
  } as unknown as PrismaClient & {
    agentSkill: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
    __tx: typeof tx;
  };
}

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma);
  });

  describe("mapAgentSkillToDocument / toSkillDocument", () => {
    it("projects exactly the SkillDocument fields from an AgentSkill", () => {
      const skill = makeSkill({
        id: "s1",
        repoSlug: "org/repo",
        name: "n",
        description: "d",
        taskCategory: "cat",
        skillMarkdown: "md",
        utilityScore: 0.5,
        successCount: 99,
        failureCount: 99,
      });

      const doc = mapAgentSkillToDocument(skill);

      expect(doc).toEqual({
        id: "s1",
        repoSlug: "org/repo",
        name: "n",
        description: "d",
        taskCategory: "cat",
        skillMarkdown: "md",
        utilityScore: 0.5,
        lastUsedAt: skill.lastUsedAt,
      });
      expect(doc).not.toHaveProperty("successCount");
      expect(doc).not.toHaveProperty("failureCount");
      expect(doc).not.toHaveProperty("archivedAt");
    });
  });

  describe("create", () => {
    it("initializes utilityScore/successCount/failureCount to zero and returns the created row", async () => {
      const created = makeSkill({ id: "new-1" });
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "n",
        description: "d",
        taskCategory: "cat",
        skillMarkdown: "md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "n",
          description: "d",
          taskCategory: "cat",
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
      const skill = makeSkill({ id: "skill-7" });
      prisma.agentSkill.findUnique.mockResolvedValue(skill);

      const result = await repo.findById("skill-7");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-7" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      prisma.agentSkill.findUnique.mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the +/- windowMs range around the given time, ordered by createdAt desc", async () => {
      const around = new Date("2026-01-01T00:00:10.000Z");
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);

      const result = await repo.findByRepoCategoryNearTime("org/repo", "auth", around, 5000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "auth",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("defaults windowMs to 5000 when not provided", async () => {
      const around = new Date("2026-01-01T00:00:10.000Z");
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      await repo.findByRepoCategoryNearTime("org/repo", "auth", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "auth",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when no skill was distilled near that time", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      const result = await repo.findByRepoCategoryNearTime("org/repo", "auth", new Date());

      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("filters by repoSlug and archivedAt: null", async () => {
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts active (non-archived) skills for the repo", async () => {
      prisma.agentSkill.count.mockResolvedValue(4);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc and returns the lowest", async () => {
      const skill = makeSkill({ id: "lowest" });
      prisma.agentSkill.findFirst.mockResolvedValue(skill);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when the repo has no active skills", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date via update", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores against active skills, sorts descending by relevance, and caps at min(k, MAX_SKILLS_INJECTED)", async () => {
      const activeSkills = [
        makeSkill({
          id: "s-db",
          taskCategory: "database migration",
          skillMarkdown: "Run alembic migrations in order",
          name: "db-migration",
          description: "db",
        }),
        makeSkill({
          id: "s-auth",
          taskCategory: "auth middleware",
          skillMarkdown: "JWT token authentication setup",
          name: "auth-middleware",
          description: "auth",
        }),
        makeSkill({
          id: "s-rate",
          taskCategory: "API rate limiting",
          skillMarkdown: "Use Redis for rate limit buckets",
          name: "rate-limiting",
          description: "rate",
        }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(activeSkills);

      const k = Math.min(2, env.MAX_SKILLS_INJECTED);
      const result = await repo.findTopKByRelevance(
        "org/repo",
        "add JWT authentication middleware",
        2,
      );

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result.length).toBe(k);
      // The auth skill should score highest for this query and be first.
      expect(result[0].id).toBe("s-auth");
      // Every element must be a properly-shaped SkillDocument (no successCount/failureCount leak).
      for (const doc of result) {
        expect(doc).not.toHaveProperty("successCount");
        expect(doc).not.toHaveProperty("failureCount");
      }
    });

    it("never returns more than env.MAX_SKILLS_INJECTED even when k and the pool are larger", async () => {
      const activeSkills = Array.from({ length: env.MAX_SKILLS_INJECTED + 5 }, (_, i) =>
        makeSkill({
          id: `s-${i}`,
          taskCategory: `category ${i}`,
          skillMarkdown: `skill markdown number ${i}`,
        }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(activeSkills);

      const result = await repo.findTopKByRelevance("org/repo", "some query", 1000);

      expect(result.length).toBe(env.MAX_SKILLS_INJECTED);
    });

    it("returns an empty array when the repo has no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1 });
      prisma.__tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.__tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      // newSuccessCount = 3, utilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          successCount: 3,
          utilityScore: 0.6,
        }),
      });
      const call = prisma.__tx.agentSkill.update.mock.calls[0][0];
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toBe(updated);
    });

    it("propagates the error when the skill does not exist", async () => {
      prisma.__tx.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("not found"));

      await expect(repo.incrementSuccess("missing")).rejects.toThrow("not found");
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ id: "skill-1", successCount: 2, failureCount: 2 });
      prisma.__tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, utilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          failureCount: 2,
          utilityScore: 0.4,
        }),
      });
      expect(result).toBe(updated);
    });

    it("propagates the error when the skill does not exist", async () => {
      prisma.__tx.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("not found"));

      await expect(repo.incrementFailure("missing")).rejects.toThrow("not found");
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore < 0.2 and totalUses >= 5", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const skill = makeSkill({ id: "low-1", utilityScore: 0.1, successCount: 0, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does NOT archive when utilityScore is low but totalUses < 5 (boundary)", async () => {
      const skill = makeSkill({ id: "low-2", utilityScore: 0.1, successCount: 0, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does NOT archive when utilityScore is exactly 0.2 (boundary, not < 0.2)", async () => {
      const skill = makeSkill({ id: "boundary", utilityScore: 0.2, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does NOT archive when utilityScore is high even with many uses", async () => {
      const skill = makeSkill({ id: "high", utilityScore: 0.9, successCount: 9, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one inside a transaction", async () => {
      const lowest = makeSkill({ id: "to-displace", utilityScore: 0.05 });
      prisma.__tx.agentSkill.findFirst.mockResolvedValue(lowest);
      const newSkill = makeSkill({ id: "new-skill" });
      prisma.__tx.agentSkill.create.mockResolvedValue(newSkill);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "n",
        description: "d",
        taskCategory: "cat",
        skillMarkdown: "md",
      });

      expect(prisma.__tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "to-displace" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.__tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "n",
          description: "d",
          taskCategory: "cat",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "to-displace" });
    });

    it("throws without creating or archiving anything when there is no active skill to displace", async () => {
      prisma.__tx.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "n",
          description: "d",
          taskCategory: "cat",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(prisma.__tx.agentSkill.update).not.toHaveBeenCalled();
      expect(prisma.__tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
