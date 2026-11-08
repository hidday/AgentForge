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
    repoSlug: "acme/widgets",
    name: "add-retry-logic",
    description: "Adds retry logic to flaky network calls",
    taskCategory: "backend",
    skillMarkdown: "# Add retry logic\nUse exponential backoff.",
    utilityScore: 0.5,
    successCount: 1,
    failureCount: 1,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  const agentSkill = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    ...overrides,
  };
  const prisma = {
    agentSkill,
    $transaction: vi.fn(async (cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
  };
  return prisma as unknown as PrismaClient & { agentSkill: typeof agentSkill };
}

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  describe("mapAgentSkillToDocument", () => {
    it("projects only the SkillDocument fields", () => {
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

  describe("create", () => {
    it("initializes utilityScore/successCount/failureCount to zero", async () => {
      prisma.agentSkill.create.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma);

      await repo.create({
        repoSlug: "acme/widgets",
        name: "add-retry-logic",
        description: "desc",
        taskCategory: "backend",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "add-retry-logic",
          description: "desc",
          taskCategory: "backend",
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
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when not found", async () => {
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries with a time window of +/- the default 5000ms around the given time", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2024-06-01T12:00:00Z");

      await repo.findByRepoCategoryNearTime("acme/widgets", "backend", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "backend",
          createdAt: {
            gte: new Date("2024-06-01T11:59:55Z"),
            lte: new Date("2024-06-01T12:00:05Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("honors a custom windowMs", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2024-06-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("acme/widgets", "backend", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "backend",
          createdAt: {
            gte: new Date("2024-06-01T11:59:59Z"),
            lte: new Date("2024-06-01T12:00:01Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("filters to the given repo with archivedAt null", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("acme/widgets");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts active skills for the repo", async () => {
      prisma.agentSkill.count.mockResolvedValue(4);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.countActiveByRepo("acme/widgets");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const lowest = makeSkill({ id: "lowest" });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("acme/widgets");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.id).toBe("lowest");
    });

    it("returns null when there are no active skills", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("acme/widgets");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query and returns top k as SkillDocuments", async () => {
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "authentication",
        skillMarkdown: "# Authentication flow\nHandles OAuth2 login redirects.",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "unrelated-topic-zzz",
        skillMarkdown: "# Totally different subject matter about plumbing fixtures.",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("acme/widgets", "OAuth2 login authentication", 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("relevant");
      expect(result[0]).not.toHaveProperty("successCount");
    });

    it("caps k at the configured MAX_SKILLS_INJECTED even if a larger k is requested", async () => {
      const skills = Array.from({ length: 8 }, (_, i) => makeSkill({ id: `skill-${i}` }));
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("acme/widgets", "query text", 50);

      expect(result.length).toBeLessThanOrEqual(10);
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("acme/widgets", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore within a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...existing, ...args.data }),
      );
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementSuccess("skill-1");

      // successCount: 2 -> 3, utilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 0.6,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("propagates an error when the skill does not exist", async () => {
      prisma.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("not found"));
      const repo = new AgentSkillRepository(prisma);

      await expect(repo.incrementSuccess("missing")).rejects.toThrow("not found");
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore within a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...existing, ...args.data }),
      );
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementFailure("skill-1");

      // failureCount: 1 -> 2, utilityScore = 2 / (2 + 2 + 1) = 0.4
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
    it("archives when utilityScore is below 0.2 and total uses is at least 5", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is exactly at the 0.2 boundary", async () => {
      const skill = makeSkill({ utilityScore: 0.2, successCount: 1, failureCount: 4 });
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses is below the 5-use threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 2 });
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("archives at exactly the 5-use boundary when utility is low", async () => {
      const skill = makeSkill({ utilityScore: 0.19, successCount: 0, failureCount: 5 });
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility skill and creates the new skill within a transaction", async () => {
      const lowest = makeSkill({ id: "lowest", utilityScore: 0.05 });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      const newSkill = makeSkill({ id: "new-skill", utilityScore: 0 });
      prisma.agentSkill.create.mockResolvedValue(newSkill);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.displaceAndCreate("acme/widgets", {
        name: "new-skill",
        description: "desc",
        taskCategory: "backend",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "new-skill",
          description: "desc",
          taskCategory: "backend",
          skillMarkdown: "# md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "lowest" });
    });

    it("throws without mutating anything when there is no active skill to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.displaceAndCreate("acme/widgets", {
          name: "new-skill",
          description: "desc",
          taskCategory: "backend",
          skillMarkdown: "# md",
        }),
      ).rejects.toThrow("No active skills found for repo acme/widgets to displace");

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
