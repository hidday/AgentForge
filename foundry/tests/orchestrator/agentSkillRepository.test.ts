import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "auth-middleware",
    description: "Use when adding auth middleware.",
    taskCategory: "auth middleware",
    skillMarkdown: "Use JWT tokens with RS256 for stateless auth.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastUsedAt: new Date("2026-01-02T00:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  };
}

function makeMockPrisma() {
  const tx = {
    agentSkill: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
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
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)),
    __tx: tx,
  };
}

describe("AgentSkillRepository", () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    mockPrisma = makeMockPrisma();
    repo = new AgentSkillRepository(mockPrisma as never);
  });

  describe("mapAgentSkillToDocument", () => {
    it("projects only the SkillDocument fields from a skill row", () => {
      const skill = makeSkill();
      const doc = mapAgentSkillToDocument(skill as never);

      expect(doc).toEqual({
        id: "skill-1",
        repoSlug: "org/repo",
        name: "auth-middleware",
        description: "Use when adding auth middleware.",
        taskCategory: "auth middleware",
        skillMarkdown: "Use JWT tokens with RS256 for stateless auth.",
        utilityScore: 0.5,
        lastUsedAt: skill.lastUsedAt,
      });
      expect(doc).not.toHaveProperty("successCount");
      expect(doc).not.toHaveProperty("archivedAt");
    });
  });

  describe("create", () => {
    it("initializes utilityScore/successCount/failureCount to zero", async () => {
      const created = makeSkill({ utilityScore: 0, successCount: 0, failureCount: 0 });
      mockPrisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "n",
        description: "d",
        taskCategory: "c",
        skillMarkdown: "m",
      });

      expect(mockPrisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "n",
          description: "d",
          taskCategory: "c",
          skillMarkdown: "m",
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
      const skill = makeSkill({ id: "s-2" });
      mockPrisma.agentSkill.findUnique.mockResolvedValue(skill);

      const result = await repo.findById("s-2");

      expect(mockPrisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "s-2" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      mockPrisma.agentSkill.findUnique.mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries a +/- windowMs range around the given time, defaulting to 5000ms", async () => {
      const around = new Date("2026-06-08T16:26:58.000Z");
      mockPrisma.agentSkill.findFirst.mockResolvedValue(null);

      await repo.findByRepoCategoryNearTime("org/repo", "auth middleware", around);

      expect(mockPrisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "auth middleware",
          createdAt: {
            gte: new Date("2026-06-08T16:26:53.000Z"),
            lte: new Date("2026-06-08T16:27:03.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("honors a custom windowMs", async () => {
      const around = new Date("2026-06-08T16:26:58.000Z");
      mockPrisma.agentSkill.findFirst.mockResolvedValue(null);

      await repo.findByRepoCategoryNearTime("org/repo", "cat", around, 1000);

      expect(mockPrisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "cat",
          createdAt: {
            gte: new Date("2026-06-08T16:26:57.000Z"),
            lte: new Date("2026-06-08T16:26:59.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns the matched skill", async () => {
      const skill = makeSkill({ id: "legacy" });
      mockPrisma.agentSkill.findFirst.mockResolvedValue(skill);

      const result = await repo.findByRepoCategoryNearTime(
        "org/repo",
        "auth middleware",
        new Date(),
      );

      expect(result).toBe(skill);
    });
  });

  describe("findActiveByRepo", () => {
    it("filters by repoSlug and archivedAt: null", async () => {
      mockPrisma.agentSkill.findMany.mockResolvedValue([]);

      await repo.findActiveByRepo("org/repo");

      expect(mockPrisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
    });

    it("returns the matched skills", async () => {
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      mockPrisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findActiveByRepo("org/repo");

      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts active skills for the repo", async () => {
      mockPrisma.agentSkill.count.mockResolvedValue(3);

      const result = await repo.countActiveByRepo("org/repo");

      expect(mockPrisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(3);
    });

    it("returns zero when there are no active skills", async () => {
      mockPrisma.agentSkill.count.mockResolvedValue(0);

      const result = await repo.countActiveByRepo("org/repo");

      expect(result).toBe(0);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const skill = makeSkill({ id: "lowest" });
      mockPrisma.agentSkill.findFirst.mockResolvedValue(skill);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(mockPrisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when there are no active skills", async () => {
      mockPrisma.agentSkill.findFirst.mockResolvedValue(null);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date on the targeted skill", async () => {
      mockPrisma.agentSkill.update.mockResolvedValue(makeSkill());

      await repo.archiveById("skill-1");

      expect(mockPrisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = mockPrisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills by relevance and returns the top k as SkillDocuments, sorted descending", async () => {
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "auth middleware",
        skillMarkdown: "Use JWT tokens with RS256 for stateless auth middleware.",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "database optimization",
        skillMarkdown: "Always cache DB connections and tune pool size.",
      });
      mockPrisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);

      const result = await repo.findTopKByRelevance("org/repo", "auth middleware", 1);

      expect(mockPrisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("relevant");
      expect(result[0]).not.toHaveProperty("successCount");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = [
        makeSkill({ id: "s1", taskCategory: "alpha" }),
        makeSkill({ id: "s2", taskCategory: "bravo" }),
        makeSkill({ id: "s3", taskCategory: "charlie" }),
        makeSkill({ id: "s4", taskCategory: "delta" }),
      ];
      mockPrisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("org/repo", "query text", 10);

      // env.MAX_SKILLS_INJECTED defaults to 3
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      mockPrisma.agentSkill.findMany.mockResolvedValue([]);

      const result = await repo.findTopKByRelevance("org/repo", "query", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore within a transaction", async () => {
      const skill = makeSkill({ id: "s-1", successCount: 2, failureCount: 1 });
      mockPrisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(skill);
      const updated = makeSkill({ id: "s-1", successCount: 3, failureCount: 1 });
      mockPrisma.__tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("s-1");

      expect(mockPrisma.__tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "s-1" },
      });
      expect(mockPrisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "s-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / (3 + 1 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore within a transaction", async () => {
      const skill = makeSkill({ id: "s-1", successCount: 2, failureCount: 1 });
      mockPrisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(skill);
      const updated = makeSkill({ id: "s-1", successCount: 2, failureCount: 2 });
      mockPrisma.__tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementFailure("s-1");

      expect(mockPrisma.__tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "s-1" },
      });
      expect(mockPrisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "s-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / (2 + 2 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore < 0.2 and totalUses >= 5", async () => {
      mockPrisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "low", utilityScore: 0.1, successCount: 2, failureCount: 3 });

      await repo.archiveIfLowUtility(skill as never);

      expect(mockPrisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive at the utilityScore boundary of exactly 0.2", async () => {
      const skill = makeSkill({ id: "boundary", utilityScore: 0.2, successCount: 3, failureCount: 2 });

      await repo.archiveIfLowUtility(skill as never);

      expect(mockPrisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when totalUses is below 5, even with low utility", async () => {
      const skill = makeSkill({ id: "few-uses", utilityScore: 0.05, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill as never);

      expect(mockPrisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one within a transaction", async () => {
      const lowest = makeSkill({ id: "lowest", repoSlug: "org/repo" });
      mockPrisma.__tx.agentSkill.findFirst.mockResolvedValue(lowest);
      const newSkill = makeSkill({ id: "new-skill", repoSlug: "org/repo", name: "new" });
      mockPrisma.__tx.agentSkill.create.mockResolvedValue(newSkill);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new",
        description: "d",
        taskCategory: "c",
        skillMarkdown: "m",
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
          name: "new",
          description: "d",
          taskCategory: "c",
          skillMarkdown: "m",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      mockPrisma.__tx.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("org/empty-repo", {
          name: "new",
          description: "d",
          taskCategory: "c",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow("No active skills found for repo org/empty-repo to displace");

      expect(mockPrisma.__tx.agentSkill.update).not.toHaveBeenCalled();
      expect(mockPrisma.__tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
