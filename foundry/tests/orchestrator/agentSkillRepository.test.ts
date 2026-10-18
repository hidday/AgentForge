import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "acme/widgets",
    name: "fix-flaky-tests",
    description: "How to fix flaky tests",
    taskCategory: "testing",
    skillMarkdown: "# Fix flaky tests\nAlways await promises.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    lastUsedAt: new Date("2024-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
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

type FakePrisma = ReturnType<typeof makePrisma>;

describe("AgentSkillRepository", () => {
  let prisma: FakePrisma;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
  });

  describe("create", () => {
    it("creates a skill with zeroed counters and scores", async () => {
      const created = makeSkill();
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.create({
        repoSlug: "acme/widgets",
        name: "fix-flaky-tests",
        description: "How to fix flaky tests",
        taskCategory: "testing",
        skillMarkdown: "# Fix flaky tests",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "fix-flaky-tests",
          description: "How to fix flaky tests",
          taskCategory: "testing",
          skillMarkdown: "# Fix flaky tests",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toBe(created);
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.agentSkill.create.mockRejectedValue(new Error("db unavailable"));

      await expect(
        repo.create({
          repoSlug: "acme/widgets",
          name: "n",
          description: "d",
          taskCategory: "t",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow("db unavailable");
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
    it("queries within the time window around the given date, newest first", async () => {
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const around = new Date("2024-06-01T12:00:00.000Z");

      const result = await repo.findByRepoCategoryNearTime("acme/widgets", "testing", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "testing",
          createdAt: {
            gte: new Date("2024-06-01T11:59:59.000Z"),
            lte: new Date("2024-06-01T12:00:01.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("defaults the window to 5000ms when not provided", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2024-06-01T12:00:00.000Z");

      const result = await repo.findByRepoCategoryNearTime("acme/widgets", "testing", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date("2024-06-01T11:59:55.000Z"),
              lte: new Date("2024-06-01T12:00:05.000Z"),
            },
          }),
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("returns only non-archived skills for the repo", async () => {
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findActiveByRepo("acme/widgets");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toEqual(skills);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);

      const result = await repo.findActiveByRepo("acme/widgets");

      expect(result).toEqual([]);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the count of active skills", async () => {
      prisma.agentSkill.count.mockResolvedValue(4);

      const result = await repo.countActiveByRepo("acme/widgets");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toBe(4);
    });

    it("returns 0 when there are no active skills", async () => {
      prisma.agentSkill.count.mockResolvedValue(0);

      const result = await repo.countActiveByRepo("acme/widgets");

      expect(result).toBe(0);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("returns the lowest-utility active skill", async () => {
      const skill = makeSkill({ id: "lowest" });
      prisma.agentSkill.findFirst.mockResolvedValue(skill);

      const result = await repo.findLowestUtilityActive("acme/widgets");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when there are no active skills", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      const result = await repo.findLowestUtilityActive("acme/widgets");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const before = Date.now();

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
      expect(call.data.archivedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("propagates errors from the underlying prisma call", async () => {
      prisma.agentSkill.update.mockRejectedValue(new Error("not found"));

      await expect(repo.archiveById("missing")).rejects.toThrow("not found");
    });
  });

  describe("findTopKByRelevance", () => {
    it("returns the top-k most relevant skills as SkillDocuments, scoped by MAX_SKILLS_INJECTED", async () => {
      const exact = makeSkill({
        id: "exact",
        taskCategory: "fix flaky integration tests",
        skillMarkdown: "fix flaky integration tests by awaiting promises",
      });
      const unrelated1 = makeSkill({ id: "u1", taskCategory: "zzz", skillMarkdown: "zzzzzzzzzz" });
      const unrelated2 = makeSkill({ id: "u2", taskCategory: "qqq", skillMarkdown: "qqqqqqqqqq" });
      prisma.agentSkill.findMany.mockResolvedValue([unrelated1, unrelated2, exact]);

      const result = await repo.findTopKByRelevance(
        "acme/widgets",
        "fix flaky integration tests",
        10,
      );

      // env.MAX_SKILLS_INJECTED defaults to 3, so even asking for 10 is capped at 3.
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe("exact");
    });

    it("maps results into SkillDocument shape", async () => {
      const skill = makeSkill({ id: "doc-1", taskCategory: "docs", skillMarkdown: "write docs" });
      prisma.agentSkill.findMany.mockResolvedValue([skill]);

      const result = await repo.findTopKByRelevance("acme/widgets", "write docs", 1);

      expect(result).toEqual([
        {
          id: "doc-1",
          repoSlug: skill.repoSlug,
          name: skill.name,
          description: skill.description,
          taskCategory: skill.taskCategory,
          skillMarkdown: skill.skillMarkdown,
          utilityScore: skill.utilityScore,
          lastUsedAt: skill.lastUsedAt,
        },
      ]);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);

      const result = await repo.findTopKByRelevance("acme/widgets", "anything", 5);

      expect(result).toEqual([]);
    });
  });

  describe("mapAgentSkillToDocument", () => {
    it("maps an AgentSkill row to a SkillDocument", () => {
      const skill = makeSkill({ id: "map-1" });

      const doc = mapAgentSkillToDocument(skill);

      expect(doc).toEqual({
        id: "map-1",
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
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const current = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(current),
          update: vi.fn().mockResolvedValue(updated),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      const result = await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newSuccessCount = 3, utilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          successCount: 3,
          utilityScore: 0.6,
          lastUsedAt: expect.any(Date),
        }),
      });
      expect(result).toBe(updated);
    });

    it("propagates errors raised while loading the skill", async () => {
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockRejectedValue(new Error("P2025")),
          update: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      await expect(repo.incrementSuccess("missing")).rejects.toThrow("P2025");
      expect(tx.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const current = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 2, failureCount: 2 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(current),
          update: vi.fn().mockResolvedValue(updated),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, utilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          failureCount: 2,
          utilityScore: 0.4,
          lastUsedAt: expect.any(Date),
        }),
      });
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utility is below threshold and usage meets the minimum", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "low", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is exactly at the threshold", async () => {
      const skill = makeSkill({ id: "boundary", utilityScore: 0.2, successCount: 3, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses are below the minimum, even with low utility", async () => {
      const skill = makeSkill({ id: "too-new", utilityScore: 0.01, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("archives at the exact boundary of 5 total uses with sub-threshold utility", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "exact5", utilityScore: 0.19, successCount: 2, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility skill and creates a new one inside a transaction", async () => {
      const lowest = makeSkill({ id: "lowest", utilityScore: 0.05 });
      const newSkill = makeSkill({ id: "new-1", name: "new-skill" });
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(lowest),
          update: vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() }),
          create: vi.fn().mockResolvedValue(newSkill),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      const result = await repo.displaceAndCreate("acme/widgets", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "md",
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
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      await expect(
        repo.displaceAndCreate("acme/widgets", {
          name: "n",
          description: "d",
          taskCategory: "t",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow("No active skills found for repo acme/widgets to displace");
      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
