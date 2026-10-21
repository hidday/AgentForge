import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentSkillRepository, mapAgentSkillToDocument } from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "acme/widgets",
    name: "fix-flaky-tests",
    description: "How to stabilize flaky tests",
    taskCategory: "testing",
    skillMarkdown: "# Fix flaky tests\nRetry with backoff.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    archivedAt: null,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2025-12-01T00:00:00Z"),
    ...overrides,
  };
}

function makeTx() {
  return {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
}

function makePrisma(tx = makeTx()) {
  const prisma = {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(tx)),
  } as unknown as PrismaClient & { $transaction: ReturnType<typeof vi.fn> };
  return { prisma, tx };
}

describe("AgentSkillRepository", () => {
  describe("mapAgentSkillToDocument", () => {
    it("projects a persisted skill into the SkillDocument shape", () => {
      const skill = makeSkill();
      const doc = mapAgentSkillToDocument(skill);

      expect(doc).toEqual({
        id: "skill-1",
        repoSlug: "acme/widgets",
        name: "fix-flaky-tests",
        description: "How to stabilize flaky tests",
        taskCategory: "testing",
        skillMarkdown: skill.skillMarkdown,
        utilityScore: 0.5,
        lastUsedAt: skill.lastUsedAt,
      });
    });
  });

  describe("create", () => {
    it("initializes a new skill with zeroed score and counters", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma);

      await repo.create({
        repoSlug: "acme/widgets",
        name: "fix-flaky-tests",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "fix-flaky-tests",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when not found", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);

      expect(await repo.findById("missing")).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("uses a +/- windowMs range around the given time, defaulting to 5000ms", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-01-01T00:00:10.000Z");

      await repo.findByRepoCategoryNearTime("acme/widgets", "testing", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "testing",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("respects a custom windowMs", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-01-01T00:00:10.000Z");

      await repo.findByRepoCategoryNearTime("acme/widgets", "testing", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date("2026-01-01T00:00:09.000Z"),
            lte: new Date("2026-01-01T00:00:11.000Z"),
          },
        }),
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findActiveByRepo", () => {
    it("queries only non-archived skills for the repo", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeSkill()]);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("acme/widgets");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the count of active skills for the repo", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.count as ReturnType<typeof vi.fn>).mockResolvedValue(4);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.countActiveByRepo("acme/widgets");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill({ utilityScore: 0.1 }));
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("acme/widgets");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.utilityScore).toBe(0.1);
    });

    it("returns null when there are no active skills", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);

      expect(await repo.findLowestUtilityActive("acme/widgets")).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query and returns the top k", async () => {
      const { prisma } = makePrisma();
      const skills = [
        makeSkill({ id: "s-low", taskCategory: "unrelated", skillMarkdown: "nothing in common here" }),
        makeSkill({ id: "s-high", taskCategory: "testing", skillMarkdown: "flaky test retry backoff" }),
      ];
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("acme/widgets", "flaky test retry", 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("s-high");
    });

    it("caps the returned count at env.MAX_SKILLS_INJECTED even if k is larger", async () => {
      const { prisma } = makePrisma();
      const skills = Array.from({ length: 5 }, (_, i) => makeSkill({ id: `s-${i}`, taskCategory: `cat-${i}` }));
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("acme/widgets", "cat-1", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      const { prisma } = makePrisma();
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma);

      expect(await repo.findTopKByRelevance("acme/widgets", "anything", 3)).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const tx = makeTx();
      const { prisma } = makePrisma(tx);
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(makeSkill({ successCount: 2, failureCount: 1 }));
      tx.agentSkill.update.mockResolvedValue(makeSkill({ successCount: 3, failureCount: 1, utilityScore: 0.6 }));
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newSuccessCount = 3, newUtilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 0.6,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const tx = makeTx();
      const { prisma } = makePrisma(tx);
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(makeSkill({ successCount: 2, failureCount: 1 }));
      tx.agentSkill.update.mockResolvedValue(makeSkill({ successCount: 2, failureCount: 2, utilityScore: 0.4 }));
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, newUtilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 0.4,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility", () => {
    let repo: AgentSkillRepository;
    let prisma: ReturnType<typeof makePrisma>["prisma"];

    beforeEach(() => {
      ({ prisma } = makePrisma());
      (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      repo = new AgentSkillRepository(prisma);
    });

    it("archives the skill when utilityScore is below 0.2 and it has been used at least 5 times", async () => {
      await repo.archiveIfLowUtility(makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 }));

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is low but usage count is below 5", async () => {
      await repo.archiveIfLowUtility(makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 }));

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when usage count is sufficient but utilityScore is at or above 0.2", async () => {
      await repo.archiveIfLowUtility(makeSkill({ utilityScore: 0.2, successCount: 3, failureCount: 2 }));

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one in a single transaction", async () => {
      const tx = makeTx();
      const { prisma } = makePrisma(tx);
      const lowest = makeSkill({ id: "skill-lowest", utilityScore: 0.05 });
      tx.agentSkill.findFirst.mockResolvedValue(lowest);
      const created = makeSkill({ id: "skill-new" });
      tx.agentSkill.create.mockResolvedValue(created);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.displaceAndCreate("acme/widgets", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "# md",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "skill-lowest" });
    });

    it("throws when there are no active skills to displace", async () => {
      const tx = makeTx();
      const { prisma } = makePrisma(tx);
      tx.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.displaceAndCreate("acme/widgets", {
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
        }),
      ).rejects.toThrow("No active skills found for repo acme/widgets to displace");
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
