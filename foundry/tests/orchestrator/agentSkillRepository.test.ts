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
    repoSlug: "acme/repo",
    name: "deploy-helper",
    description: "Helps deploy things",
    taskCategory: "deployment",
    skillMarkdown: "# Deploy helper\nDo the deploy steps carefully.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    archivedAt: null,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    createdAt: new Date("2023-12-01T00:00:00Z"),
    ...overrides,
  } as AgentSkill;
}

function makeMockPrisma() {
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
    $transaction: vi.fn(async (cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
  };
  return prisma as unknown as PrismaClient & { agentSkill: typeof agentSkill };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument", () => {
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
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new AgentSkillRepository(prisma);
  });

  describe("create", () => {
    it("creates a skill with counters zeroed out", async () => {
      prisma.agentSkill.create.mockResolvedValue(makeSkill());

      await repo.create({
        repoSlug: "acme/repo",
        name: "deploy-helper",
        description: "Helps deploy",
        taskCategory: "deployment",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/repo",
          name: "deploy-helper",
          description: "Helps deploy",
          taskCategory: "deployment",
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
      prisma.agentSkill.findUnique.mockResolvedValue(makeSkill());
      const result = await repo.findById("skill-1");
      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when not found", async () => {
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      expect(await repo.findById("missing")).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within a time window around the given instant, newest first", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const around = new Date("2024-01-01T00:00:00Z");

      await repo.findByRepoCategoryNearTime("acme/repo", "deployment", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date("2023-12-31T23:59:59.000Z"),
            lte: new Date("2024-01-01T00:00:01.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("defaults the window to 5000ms when not specified", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2024-01-01T00:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("acme/repo", "deployment", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date("2023-12-31T23:59:55.000Z"),
            lte: new Date("2024-01-01T00:00:05.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries only non-archived skills for the repo", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const result = await repo.findActiveByRepo("acme/repo");
      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts only non-archived skills for the repo", async () => {
      prisma.agentSkill.count.mockResolvedValue(4);
      const result = await repo.countActiveByRepo("acme/repo");
      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc, then lastUsedAt asc", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      await repo.findLowestUtilityActive("acme/repo");
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
    });

    it("returns null when there are no active skills", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      expect(await repo.findLowestUtilityActive("acme/repo")).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt on the skill", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      await repo.archiveById("skill-1");
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query and returns the top k as SkillDocuments", async () => {
      const skills = [
        makeSkill({ id: "s-irrelevant", taskCategory: "unrelated", skillMarkdown: "zzz qux" }),
        makeSkill({ id: "s-relevant", taskCategory: "deployment", skillMarkdown: "deploy the app safely" }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("acme/repo", "deployment", 5);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result[0].id).toBe("s-relevant");
      expect(result.every((d) => "skillMarkdown" in d)).toBe(true);
    });

    it("caps results at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const skills = Array.from({ length: 6 }, (_, i) =>
        makeSkill({ id: `s-${i}`, taskCategory: "deployment" }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("acme/repo", "deployment", 100);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const result = await repo.findTopKByRelevance("acme/repo", "deployment", 3);
      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockImplementation(async ({ data }) => ({ ...existing, ...data }));

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      // newSuccessCount = 3, utility = 3 / (3 + 1 + 1) = 0.6
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
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
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockImplementation(async ({ data }) => ({ ...existing, ...data }));

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, utility = 2 / (2 + 2 + 1) = 0.4
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
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
    it("archives a skill with low utility and enough uses", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is low but usage count is below the threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 1 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility is not low even with many uses", async () => {
      const skill = makeSkill({ utilityScore: 0.9, successCount: 10, failureCount: 10 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a new one in its place, inside a transaction", async () => {
      const lowest = makeSkill({ id: "s-lowest", utilityScore: 0.05 });
      const created = makeSkill({ id: "s-new" });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("acme/repo", {
        name: "new-skill",
        description: "new desc",
        taskCategory: "deployment",
        skillMarkdown: "# new",
      });

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "s-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/repo",
          name: "new-skill",
          description: "new desc",
          taskCategory: "deployment",
          skillMarkdown: "# new",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "s-lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("acme/repo", {
          name: "new-skill",
          description: "new desc",
          taskCategory: "deployment",
          skillMarkdown: "# new",
        }),
      ).rejects.toThrow("No active skills found for repo acme/repo to displace");

      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
