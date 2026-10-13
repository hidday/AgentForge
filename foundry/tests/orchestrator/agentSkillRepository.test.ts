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
    name: "example-skill",
    description: "An example skill",
    taskCategory: "bug-fix",
    skillMarkdown: "# Bug fix skill\nDo the thing.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function buildPrisma() {
  const tx = {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };
  const agentSkill = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  };
  const $transaction = vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx));
  const prisma = { agentSkill, $transaction } as unknown as PrismaClient;
  return { prisma, agentSkill, tx, $transaction };
}

describe("AgentSkillRepository", () => {
  let prisma: PrismaClient;
  let agentSkill: ReturnType<typeof buildPrisma>["agentSkill"];
  let tx: ReturnType<typeof buildPrisma>["tx"];
  let repo: AgentSkillRepository;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    agentSkill = built.agentSkill;
    tx = built.tx;
    repo = new AgentSkillRepository(prisma);
  });

  describe("create", () => {
    it("creates with provided fields and zeroed counters/score", async () => {
      agentSkill.create.mockResolvedValue(makeSkill());

      await repo.create({
        repoSlug: "org/repo",
        name: "example-skill",
        description: "An example skill",
        taskCategory: "bug-fix",
        skillMarkdown: "# Bug fix skill",
      });

      expect(agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "example-skill",
          description: "An example skill",
          taskCategory: "bug-fix",
          skillMarkdown: "# Bug fix skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
    });

    it("returns the created row as-is (no mapping)", async () => {
      const created = makeSkill({ id: "new-skill" });
      agentSkill.create.mockResolvedValue(created);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "n",
        description: "d",
        taskCategory: "t",
        skillMarkdown: "m",
      });

      expect(result).toBe(created);
    });
  });

  describe("findById", () => {
    it("queries by id", async () => {
      agentSkill.findUnique.mockResolvedValue(makeSkill());

      await repo.findById("skill-1");

      expect(agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    });

    it("returns null when not found", async () => {
      agentSkill.findUnique.mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within a +/- windowMs range around the given time, defaulting windowMs to 5000", async () => {
      agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2026-01-01T00:00:10.000Z");

      await repo.findByRepoCategoryNearTime("org/repo", "bug-fix", around);

      expect(agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "bug-fix",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("honors a custom windowMs", async () => {
      agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2026-01-01T00:00:10.000Z");

      await repo.findByRepoCategoryNearTime("org/repo", "bug-fix", around, 1000);

      expect(agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "bug-fix",
          createdAt: {
            gte: new Date("2026-01-01T00:00:09.000Z"),
            lte: new Date("2026-01-01T00:00:11.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when no skill matches", async () => {
      agentSkill.findFirst.mockResolvedValue(null);

      const result = await repo.findByRepoCategoryNearTime("org/repo", "bug-fix", new Date());

      expect(result).toBeNull();
    });

    it("returns the matching skill when found", async () => {
      const skill = makeSkill({ id: "near-time" });
      agentSkill.findFirst.mockResolvedValue(skill);

      const result = await repo.findByRepoCategoryNearTime("org/repo", "bug-fix", new Date());

      expect(result).toBe(skill);
    });
  });

  describe("findActiveByRepo", () => {
    it("queries non-archived skills for the repo", async () => {
      agentSkill.findMany.mockResolvedValue([]);

      await repo.findActiveByRepo("org/repo");

      expect(agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
    });

    it("returns the rows from prisma", async () => {
      const skills = [makeSkill({ id: "s1" }), makeSkill({ id: "s2" })];
      agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findActiveByRepo("org/repo");

      expect(result).toBe(skills);
    });

    it("returns an empty array when there are no active skills", async () => {
      agentSkill.findMany.mockResolvedValue([]);

      const result = await repo.findActiveByRepo("org/repo");

      expect(result).toEqual([]);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      agentSkill.count.mockResolvedValue(7);

      const result = await repo.countActiveByRepo("org/repo");

      expect(agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });

    it("returns 0 when there are no active skills", async () => {
      agentSkill.count.mockResolvedValue(0);

      const result = await repo.countActiveByRepo("org/repo");

      expect(result).toBe(0);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc, then lastUsedAt asc, restricted to active skills", async () => {
      agentSkill.findFirst.mockResolvedValue(null);

      await repo.findLowestUtilityActive("org/repo");

      expect(agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
    });

    it("returns null when there are no active skills", async () => {
      agentSkill.findFirst.mockResolvedValue(null);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });

    it("returns the lowest-utility skill when found", async () => {
      const skill = makeSkill({ id: "lowest" });
      agentSkill.findFirst.mockResolvedValue(skill);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBe(skill);
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date for the given id", async () => {
      agentSkill.update.mockResolvedValue(makeSkill());

      await repo.archiveById("skill-1");

      expect(agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("mapAgentSkillToDocument / findTopKByRelevance mapping", () => {
    it("maps an AgentSkill row to a SkillDocument with only the document fields", () => {
      const skill = makeSkill({
        id: "s1",
        repoSlug: "org/repo",
        name: "n",
        description: "d",
        taskCategory: "t",
        skillMarkdown: "m",
        utilityScore: 0.42,
        successCount: 9,
        failureCount: 1,
      });

      const doc = mapAgentSkillToDocument(skill);

      expect(doc).toEqual({
        id: "s1",
        repoSlug: "org/repo",
        name: "n",
        description: "d",
        taskCategory: "t",
        skillMarkdown: "m",
        utilityScore: 0.42,
        lastUsedAt: skill.lastUsedAt,
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("queries active skills for the repo via findActiveByRepo", async () => {
      agentSkill.findMany.mockResolvedValue([]);

      await repo.findTopKByRelevance("org/repo", "bug-fix", 3);

      expect(agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
    });

    it("returns an empty array when there are no active skills", async () => {
      agentSkill.findMany.mockResolvedValue([]);

      const result = await repo.findTopKByRelevance("org/repo", "bug-fix", 3);

      expect(result).toEqual([]);
    });

    it("orders results by relevance score descending", async () => {
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "aaa",
        skillMarkdown: "aaa",
        name: null,
        description: null,
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "zzz",
        skillMarkdown: "zzz",
        name: null,
        description: null,
      });
      // Insert irrelevant first to prove sorting happens (not just passthrough order).
      agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);

      const result = await repo.findTopKByRelevance("org/repo", "aaa", 2);

      expect(result.map((d) => d.id)).toEqual(["relevant", "irrelevant"]);
    });

    it("caps results at k when k is below env.MAX_SKILLS_INJECTED", async () => {
      const skills = [
        makeSkill({ id: "s1", taskCategory: "aaa", skillMarkdown: "aaa" }),
        makeSkill({ id: "s2", taskCategory: "aab", skillMarkdown: "aab" }),
        makeSkill({ id: "s3", taskCategory: "zzz", skillMarkdown: "zzz" }),
      ];
      agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("org/repo", "aaa", 1);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("s1");
    });

    it("caps results at env.MAX_SKILLS_INJECTED when k exceeds it", async () => {
      const total = env.MAX_SKILLS_INJECTED + 2;
      const skills = Array.from({ length: total }, (_, i) =>
        makeSkill({
          id: `s${i}`,
          // Decreasing relevance: s0 matches "query" exactly, later ones diverge more.
          taskCategory: i === 0 ? "query" : `unrelated-${"x".repeat(i)}`,
          skillMarkdown: i === 0 ? "query" : `unrelated-${"x".repeat(i)}`,
        }),
      );
      agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("org/repo", "query", total);

      expect(result).toHaveLength(env.MAX_SKILLS_INJECTED);
      expect(result[0]?.id).toBe("s0");
    });

    it("maps each result to a SkillDocument shape", async () => {
      const skill = makeSkill({ id: "s1", taskCategory: "query", skillMarkdown: "query" });
      agentSkill.findMany.mockResolvedValue([skill]);

      const result = await repo.findTopKByRelevance("org/repo", "query", 3);

      expect(result[0]).toEqual({
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

  describe("incrementSuccess", () => {
    it("reads the skill inside a transaction, increments successCount, and recomputes utilityScore", async () => {
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(
        makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 }),
      );
      const updated = makeSkill({ id: "skill-1", successCount: 3 });
      tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newSuccessCount = 3, utilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 0.6,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });

    it("throws when the skill does not exist (findUniqueOrThrow rejects)", async () => {
      tx.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("Record not found"));

      await expect(repo.incrementSuccess("missing")).rejects.toThrow("Record not found");
      expect(tx.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("incrementFailure", () => {
    it("reads the skill inside a transaction, increments failureCount, and recomputes utilityScore", async () => {
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(
        makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 }),
      );
      const updated = makeSkill({ id: "skill-1", failureCount: 2 });
      tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, utilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 0.4,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });

    it("throws when the skill does not exist (findUniqueOrThrow rejects)", async () => {
      tx.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("Record not found"));

      await expect(repo.incrementFailure("missing")).rejects.toThrow("Record not found");
      expect(tx.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utilityScore < 0.2 and total uses >= 5", async () => {
      agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "low-util", utilityScore: 0.1, successCount: 3, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-util" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("archives at the exact boundary of totalUses === 5", async () => {
      agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "boundary", utilityScore: 0.19, successCount: 5, failureCount: 0 });

      await repo.archiveIfLowUtility(skill);

      expect(agentSkill.update).toHaveBeenCalled();
    });

    it("does not archive when utilityScore is exactly 0.2 (not below threshold)", async () => {
      const skill = makeSkill({ id: "at-threshold", utilityScore: 0.2, successCount: 5, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when totalUses is below 5, even with low utility", async () => {
      const skill = makeSkill({ id: "too-few-uses", utilityScore: 0.05, successCount: 2, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new skill inside a transaction", async () => {
      const lowestUtility = makeSkill({ id: "lowest", repoSlug: "org/repo" });
      const newSkillRow = makeSkill({ id: "new-skill", repoSlug: "org/repo", name: "new" });
      tx.agentSkill.findFirst.mockResolvedValue(lowestUtility);
      tx.agentSkill.update.mockResolvedValue({ ...lowestUtility, archivedAt: new Date() });
      tx.agentSkill.create.mockResolvedValue(newSkillRow);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new",
        description: "desc",
        taskCategory: "cat",
        skillMarkdown: "md",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: newSkillRow, displacedSkillId: "lowest" });
    });

    it("throws and does not create when there is no active skill to displace", async () => {
      tx.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
