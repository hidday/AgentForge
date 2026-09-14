import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "auth-flow",
    description: "How to wire up auth",
    taskCategory: "auth",
    skillMarkdown: "# Auth flow\nUse OAuth2 with PKCE.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

describe("mapAgentSkillToDocument", () => {
  it("projects an AgentSkill row onto a SkillDocument", () => {
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
  describe("create", () => {
    it("creates with the given fields and zeroed counters/utility", async () => {
      const prisma = makePrismaMock();
      const created = makeSkill();
      prisma.agentSkill.create.mockResolvedValue(created);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "auth-flow",
        description: "How to wire up auth",
        taskCategory: "auth",
        skillMarkdown: "# Auth flow",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "auth-flow",
          description: "How to wire up auth",
          taskCategory: "auth",
          skillMarkdown: "# Auth flow",
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
      const prisma = makePrismaMock();
      const skill = makeSkill();
      prisma.agentSkill.findUnique.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      expect(await repo.findById("missing")).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window around the given time", async () => {
      const prisma = makePrismaMock();
      const skill = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
      const around = new Date("2026-01-01T00:00:10Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "auth", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "auth",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("honors a custom windowMs", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
      const around = new Date("2026-01-01T00:00:10Z");

      await repo.findByRepoCategoryNearTime("org/repo", "auth", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "auth",
          createdAt: {
            gte: new Date(around.getTime() - 1000),
            lte: new Date(around.getTime() + 1000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when no fallback match exists", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findByRepoCategoryNearTime("org/repo", "auth", new Date());
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("filters to non-archived skills for the repo", async () => {
      const prisma = makePrismaMock();
      const skills = [makeSkill(), makeSkill({ id: "skill-2" })];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.count.mockResolvedValue(7);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      const prisma = makePrismaMock();
      const skill = makeSkill({ utilityScore: 0.1 });
      prisma.agentSkill.findFirst.mockResolvedValue(skill);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when there are no active skills", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      expect(await repo.findLowestUtilityActive("org/repo")).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance and returns the top k as SkillDocuments", async () => {
      const prisma = makePrismaMock();
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "authentication",
        skillMarkdown: "How to authenticate users with OAuth2 and PKCE flow tokens",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "database-migrations",
        skillMarkdown: "How to write reversible SQL schema migrations safely",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findTopKByRelevance("org/repo", "authentication oauth", 1);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("relevant");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const prisma = makePrismaMock();
      const skills = Array.from({ length: 6 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: `category-${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      // env.MAX_SKILLS_INJECTED defaults to 3.
      const result = await repo.findTopKByRelevance("org/repo", "category-0", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);
      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount, recomputes utilityScore, and bumps lastUsedAt inside a transaction", async () => {
      const prisma = makePrismaMock();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
            Promise.resolve({ ...existing, ...args.data }),
          ),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: typeof tx) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

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
      expect(result.utilityScore).toBeCloseTo(0.6);
    });

    it("propagates a not-found error from findUniqueOrThrow", async () => {
      const prisma = makePrismaMock();
      const notFound = new Error("No AgentSkill found");
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockRejectedValue(notFound),
          update: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: typeof tx) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      await expect(repo.incrementSuccess("missing")).rejects.toBe(notFound);
      expect(tx.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const prisma = makePrismaMock();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
            Promise.resolve({ ...existing, ...args.data }),
          ),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: typeof tx) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

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
      expect(result.utilityScore).toBeCloseTo(0.4);
    });
  });

  describe("archiveIfLowUtility", () => {
    let repo: AgentSkillRepository;
    let archiveSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      const prisma = makePrismaMock();
      repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
      archiveSpy = vi.spyOn(repo, "archiveById").mockResolvedValue(undefined);
    });

    it("archives when utility is below 0.2 and total uses is at least 5", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });
      await repo.archiveIfLowUtility(skill);
      expect(archiveSpy).toHaveBeenCalledWith("skill-1");
    });

    it("does not archive when utility is at or above the 0.2 threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.2, successCount: 5, failureCount: 5 });
      await repo.archiveIfLowUtility(skill);
      expect(archiveSpy).not.toHaveBeenCalled();
    });

    it("does not archive when total uses is below 5, even with low utility", async () => {
      const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 2 });
      await repo.archiveIfLowUtility(skill);
      expect(archiveSpy).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a replacement in a transaction", async () => {
      const prisma = makePrismaMock();
      const lowest = makeSkill({ id: "lowest", utilityScore: 0.01 });
      const newSkill = makeSkill({ id: "new-skill", name: "new-skill" });
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(lowest),
          update: vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() }),
          create: vi.fn().mockResolvedValue(newSkill),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: typeof tx) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "auth",
        skillMarkdown: "# New skill",
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
          name: "new-skill",
          description: "desc",
          taskCategory: "auth",
          skillMarkdown: "# New skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      const prisma = makePrismaMock();
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: typeof tx) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as unknown as PrismaClient);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "auth",
          skillMarkdown: "# New skill",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");
      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
