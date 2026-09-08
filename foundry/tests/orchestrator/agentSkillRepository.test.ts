import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
} from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "deploy-service",
    description: "How to deploy the service",
    taskCategory: "deployment",
    skillMarkdown: "# Deploy\nRun the deploy script.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    archivedAt: null,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrismaMock() {
  const tx = {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };
  const prisma = {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: typeof tx) => unknown) => fn(tx)),
    __tx: tx,
  };
  return prisma as unknown as PrismaClient & {
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
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new AgentSkillRepository(prisma);
  });

  describe("mapAgentSkillToDocument", () => {
    it("maps a raw skill row to a SkillDocument", () => {
      const skill = makeSkill();
      const doc = mapAgentSkillToDocument(skill as never);
      expect(doc).toEqual({
        id: "skill-1",
        repoSlug: "org/repo",
        name: "deploy-service",
        description: "How to deploy the service",
        taskCategory: "deployment",
        skillMarkdown: "# Deploy\nRun the deploy script.",
        utilityScore: 0.5,
        lastUsedAt: skill.lastUsedAt,
      });
    });
  });

  describe("create", () => {
    it("creates a skill with zeroed counters and score", async () => {
      const row = makeSkill();
      prisma.agentSkill.create.mockResolvedValue(row);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "deploy-service",
        description: "How to deploy the service",
        taskCategory: "deployment",
        skillMarkdown: "# Deploy\nRun the deploy script.",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "deploy-service",
          description: "How to deploy the service",
          taskCategory: "deployment",
          skillMarkdown: "# Deploy\nRun the deploy script.",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toBe(row);
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const row = makeSkill();
      prisma.agentSkill.findUnique.mockResolvedValue(row);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(row);
    });

    it("returns null when not found", async () => {
      prisma.agentSkill.findUnique.mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window around the given time", async () => {
      const row = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(row);
      const around = new Date("2026-01-01T00:00:10.000Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "deployment", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(row);
    });

    it("honors a custom window size", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2026-01-01T00:00:10.000Z");

      const result = await repo.findByRepoCategoryNearTime(
        "org/repo",
        "deployment",
        around,
        1000,
      );

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date("2026-01-01T00:00:09.000Z"),
            lte: new Date("2026-01-01T00:00:11.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries for non-archived skills in the repo", async () => {
      const rows = [makeSkill()];
      prisma.agentSkill.findMany.mockResolvedValue(rows);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(rows);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);

      const result = await repo.findActiveByRepo("org/repo");

      expect(result).toEqual([]);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the count of active skills", async () => {
      prisma.agentSkill.count.mockResolvedValue(7);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });

    it("returns 0 when there are no active skills", async () => {
      prisma.agentSkill.count.mockResolvedValue(0);

      const result = await repo.countActiveByRepo("org/repo");

      expect(result).toBe(0);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const row = makeSkill({ utilityScore: 0.1 });
      prisma.agentSkill.findFirst.mockResolvedValue(row);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(row);
    });

    it("returns null when there are no active skills", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills by relevance and returns the top k as documents", async () => {
      const relevant = makeSkill({
        id: "skill-relevant",
        taskCategory: "deployment",
        skillMarkdown: "How to deploy the service to production quickly",
      });
      const irrelevant = makeSkill({
        id: "skill-irrelevant",
        taskCategory: "unrelated-topic",
        skillMarkdown: "Completely different content about something else entirely",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);

      const result = await repo.findTopKByRelevance("org/repo", "deploy service to production", 1);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("skill-relevant");
    });

    it("caps k at env.MAX_SKILLS_INJECTED", async () => {
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: `category-${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("org/repo", "category", 100);

      // env.MAX_SKILLS_INJECTED defaults to 3
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ successCount: 3, utilityScore: 3 / 5 });
      prisma.__tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.__tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / (3 + 1 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });

    it("propagates errors when the skill does not exist", async () => {
      prisma.__tx.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("not found"));

      await expect(repo.incrementSuccess("missing")).rejects.toThrow("not found");
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ failureCount: 2, utilityScore: 2 / 5 });
      prisma.__tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / (2 + 2 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });

    it("propagates errors when the skill does not exist", async () => {
      prisma.__tx.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("not found"));

      await expect(repo.incrementFailure("missing")).rejects.toThrow("not found");
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utility is below 0.2 and total uses >= 5", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const skill = makeSkill({ id: "skill-low", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is below threshold but usage count is too low", async () => {
      const skill = makeSkill({ id: "skill-new", utilityScore: 0.1, successCount: 1, failureCount: 1 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility score is at or above the threshold", async () => {
      const skill = makeSkill({ id: "skill-good", utilityScore: 0.5, successCount: 5, failureCount: 2 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one in a transaction", async () => {
      const lowest = makeSkill({ id: "skill-lowest", utilityScore: 0.05 });
      prisma.__tx.agentSkill.findFirst.mockResolvedValue(lowest);
      const created = makeSkill({ id: "skill-new" });
      prisma.__tx.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "cat",
        skillMarkdown: "md",
      });

      expect(prisma.__tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.__tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "skill-lowest" });
    });

    it("throws when there are no active skills to displace", async () => {
      prisma.__tx.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(prisma.__tx.agentSkill.update).not.toHaveBeenCalled();
      expect(prisma.__tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
