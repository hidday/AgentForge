import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "auth-middleware",
    description: "Use when adding auth middleware.",
    taskCategory: "auth middleware",
    skillMarkdown: "Use JWT tokens for auth.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
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
  // $transaction runs the callback against a tx object that mirrors the
  // top-level client, matching how the real PrismaClient's interactive
  // transactions behave.
  const prisma = {
    agentSkill,
    $transaction: vi.fn(async (cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
  };
  return prisma;
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument with the same field values", () => {
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
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma as never);
  });

  describe("create", () => {
    it("creates with zeroed counters and utilityScore", async () => {
      prisma.agentSkill.create.mockResolvedValue(makeSkill());

      await repo.create({
        repoSlug: "test-repo",
        name: "auth-middleware",
        description: "desc",
        taskCategory: "auth middleware",
        skillMarkdown: "md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "test-repo",
          name: "auth-middleware",
          description: "desc",
          taskCategory: "auth middleware",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      prisma.agentSkill.findUnique.mockResolvedValue(makeSkill({ id: "skill-x" }));
      const result = await repo.findById("skill-x");
      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-x" } });
      expect(result?.id).toBe("skill-x");
    });

    it("returns null when not found", async () => {
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5000ms window around the given time", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const around = new Date("2024-06-01T00:00:00Z");

      await repo.findByRepoCategoryNearTime("test-repo", "auth middleware", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "test-repo",
          taskCategory: "auth middleware",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("honors a custom windowMs", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2024-06-01T00:00:00Z");

      await repo.findByRepoCategoryNearTime("test-repo", "cat", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "test-repo",
          taskCategory: "cat",
          createdAt: {
            gte: new Date(around.getTime() - 1000),
            lte: new Date(around.getTime() + 1000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when nothing matches", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const result = await repo.findByRepoCategoryNearTime("r", "c", new Date());
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("filters by repoSlug and archivedAt null", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const result = await repo.findActiveByRepo("test-repo");
      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts active skills for a repo", async () => {
      prisma.agentSkill.count.mockResolvedValue(3);
      const result = await repo.countActiveByRepo("test-repo");
      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toBe(3);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      await repo.findLowestUtilityActive("test-repo");
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
    });

    it("returns null when no active skills exist", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const result = await repo.findLowestUtilityActive("test-repo");
      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date on the given skill", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      await repo.archiveById("skill-1");
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills, sorts descending, and caps at min(k, MAX_SKILLS_INJECTED)", async () => {
      const skills = [
        makeSkill({
          id: "low",
          taskCategory: "database migration",
          skillMarkdown: "Run alembic migrations",
          name: "db-migration",
          description: "db stuff",
        }),
        makeSkill({
          id: "high",
          taskCategory: "auth middleware",
          skillMarkdown: "JWT token authentication setup for middleware",
          name: "auth-middleware",
          description: "auth stuff",
        }),
        makeSkill({
          id: "mid",
          taskCategory: "api rate limiting",
          skillMarkdown: "Use Redis for rate limit buckets",
          name: "rate-limit",
          description: "rate limiting",
        }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      // MAX_SKILLS_INJECTED defaults to 3, so k=2 should win and cap the result at 2.
      const result = await repo.findTopKByRelevance(
        "test-repo",
        "add JWT authentication middleware",
        2,
      );

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("high");
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const result = await repo.findTopKByRelevance("test-repo", "query", 5);
      expect(result).toEqual([]);
    });

    it("caps k at MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: `category ${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("test-repo", "category 1", 100);

      // env default MAX_SKILLS_INJECTED is 3
      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 }),
      );

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / (3 + 1 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
    });

    it("propagates an error when the skill does not exist", async () => {
      prisma.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("not found"));
      await expect(repo.incrementSuccess("missing")).rejects.toThrow("not found");
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ successCount: 2, failureCount: 2, utilityScore: 2 / 5 }),
      );

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / (2 + 2 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
    });

    it("propagates an error when the skill does not exist", async () => {
      prisma.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("not found"));
      await expect(repo.incrementFailure("missing")).rejects.toThrow("not found");
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utilityScore < 0.2 and totalUses >= 5", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ successCount: 0, failureCount: 5, utilityScore: 0.1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore >= 0.2", async () => {
      const skill = makeSkill({ successCount: 2, failureCount: 3, utilityScore: 0.33 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when totalUses < 5, even with a low utilityScore", async () => {
      const skill = makeSkill({ successCount: 0, failureCount: 2, utilityScore: 0.0 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("archives exactly at the boundary utilityScore < 0.2 and totalUses === 5", async () => {
      const skill = makeSkill({ successCount: 1, failureCount: 4, utilityScore: 0.19 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one inside a transaction", async () => {
      const lowest = makeSkill({ id: "lowest-skill" });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      prisma.agentSkill.create.mockResolvedValue(makeSkill({ id: "new-skill" }));

      const result = await repo.displaceAndCreate("test-repo", {
        name: "new-name",
        description: "new-desc",
        taskCategory: "new-category",
        skillMarkdown: "new-md",
      });

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest-skill" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "test-repo",
          name: "new-name",
          description: "new-desc",
          taskCategory: "new-category",
          skillMarkdown: "new-md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result.newSkill.id).toBe("new-skill");
      expect(result.displacedSkillId).toBe("lowest-skill");
    });

    it("throws when there is no active skill to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("test-repo", {
          name: "n",
          description: "d",
          taskCategory: "c",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow("No active skills found for repo test-repo to displace");

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
