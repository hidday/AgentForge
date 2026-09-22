import { describe, it, expect, vi } from "vitest";
import { AgentSkillRepository, mapAgentSkillToDocument } from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "auth-middleware",
    description: "Use when adding auth middleware.",
    taskCategory: "auth middleware",
    skillMarkdown: "Use JWT tokens for authentication in middleware.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0.5,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  };
}

function makePrisma() {
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

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument shape", () => {
    const skill = makeSkill({ id: "s1", name: "foo", utilityScore: 0.75 });
    const doc = mapAgentSkillToDocument(skill as never);
    expect(doc).toEqual({
      id: "s1",
      repoSlug: "test-repo",
      name: "foo",
      description: "Use when adding auth middleware.",
      taskCategory: "auth middleware",
      skillMarkdown: skill.skillMarkdown,
      utilityScore: 0.75,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      const prisma = makePrisma();
      const skill = makeSkill();
      prisma.agentSkill.create.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.create({
        repoSlug: "test-repo",
        name: "auth-middleware",
        description: "desc",
        taskCategory: "auth middleware",
        skillMarkdown: "markdown",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "test-repo",
          name: "auth-middleware",
          description: "desc",
          taskCategory: "auth middleware",
          skillMarkdown: "markdown",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual(skill);
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const prisma = makePrisma();
      const skill = makeSkill();
      prisma.agentSkill.findUnique.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toEqual(skill);
    });

    it("returns null when not found", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries with a time window derived from the default 5000ms window", async () => {
      const prisma = makePrisma();
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-03-01T12:00:00.000Z");

      const result = await repo.findByRepoCategoryNearTime("test-repo", "auth middleware", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "test-repo",
          taskCategory: "auth middleware",
          createdAt: {
            gte: new Date("2026-03-01T11:59:55.000Z"),
            lte: new Date("2026-03-01T12:00:05.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(skill);
    });

    it("honors a custom windowMs override", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-03-01T12:00:00.000Z");

      await repo.findByRepoCategoryNearTime("test-repo", "auth middleware", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "test-repo",
          taskCategory: "auth middleware",
          createdAt: {
            gte: new Date("2026-03-01T11:59:59.000Z"),
            lte: new Date("2026-03-01T12:00:01.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when nothing matches the window", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findByRepoCategoryNearTime(
        "test-repo",
        "auth middleware",
        new Date(),
      );

      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries only non-archived skills for the repo", async () => {
      const prisma = makePrisma();
      const skills = [makeSkill({ id: "s1" }), makeSkill({ id: "s2" })];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findActiveByRepo("test-repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toEqual(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts only non-archived skills for the repo", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.count.mockResolvedValue(4);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.countActiveByRepo("test-repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc, restricted to active skills", async () => {
      const prisma = makePrisma();
      const skill = makeSkill({ utilityScore: 0.1 });
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("test-repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toEqual(skill);
    });

    it("returns null when there are no active skills", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("test-repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date on the target skill", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills against the query and returns the top k as SkillDocuments", async () => {
      const prisma = makePrisma();
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "auth middleware",
        skillMarkdown: "Use JWT tokens for authentication in middleware layers.",
        name: "auth-middleware",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "database migrations",
        skillMarkdown: "Run migrations with a rollback plan for schema changes.",
        name: "db-migrations",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("test-repo", "auth middleware", 5);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].id).toBe("relevant");
    });

    it("caps the returned count at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const prisma = makePrisma();
      const skills = Array.from({ length: 8 }, (_, i) =>
        makeSkill({ id: `s${i}`, taskCategory: `category ${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      // default MAX_SKILLS_INJECTED is 3 (no env override in test config)
      const result = await repo.findTopKByRelevance("test-repo", "category", 8);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns fewer than k when there are fewer active skills than k", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill({ id: "only-one" })]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("test-repo", "auth", 5);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("only-one");
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("test-repo", "auth", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
      const prisma = makePrisma();
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue({ ...existing, successCount: 3 }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementSuccess("skill-1");

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
      expect(result.successCount).toBe(3);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
      const prisma = makePrisma();
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue({ ...existing, failureCount: 2 }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementFailure("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newFailureCount = 2, newUtilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          failureCount: 2,
          utilityScore: 0.4,
        }),
      });
      expect(result.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utilityScore is below 0.2 and total uses is at least 5", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "low-util", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-util" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is exactly at the 0.2 boundary (not below)", async () => {
      const prisma = makePrisma();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.2, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses is below the 5-use threshold, even with low utility", async () => {
      const prisma = makePrisma();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 3 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("archives at exactly the 5-use boundary with low utility", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "boundary", utilityScore: 0.19, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "boundary" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one inside a transaction", async () => {
      const prisma = makePrisma();
      const lowest = makeSkill({ id: "lowest", utilityScore: 0.01 });
      const created = makeSkill({ id: "new-skill", name: "new-skill" });
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(lowest),
          update: vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() }),
          create: vi.fn().mockResolvedValue(created),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("test-repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "cat",
        skillMarkdown: "md",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "test-repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      const prisma = makePrisma();
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("test-repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo test-repo to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
