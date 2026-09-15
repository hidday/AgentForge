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
    name: "Skill One",
    description: "does a thing",
    taskCategory: "backend",
    skillMarkdown: "# Skill One\ndetails about doing the thing",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    archivedAt: null,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    createdAt: new Date("2023-12-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrismaModel() {
  return {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
}

function makePrisma() {
  const agentSkill = makePrismaModel();
  const prisma = {
    agentSkill,
    $transaction: vi.fn((cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
  };
  return prisma;
}

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
  });

  describe("mapAgentSkillToDocument", () => {
    it("maps an AgentSkill row to a SkillDocument", () => {
      const skill = makeSkill();
      const doc = mapAgentSkillToDocument(skill as never);
      expect(doc).toEqual({
        id: "skill-1",
        repoSlug: "org/repo",
        name: "Skill One",
        description: "does a thing",
        taskCategory: "backend",
        skillMarkdown: "# Skill One\ndetails about doing the thing",
        utilityScore: 0.5,
        lastUsedAt: skill.lastUsedAt,
      });
    });
  });

  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      prisma.agentSkill.create.mockResolvedValue(makeSkill());

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "Skill One",
        description: "does a thing",
        taskCategory: "backend",
        skillMarkdown: "md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "Skill One",
          description: "does a thing",
          taskCategory: "backend",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result.id).toBe("skill-1");
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
      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window around the given time", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const around = new Date("2024-01-01T00:00:10.000Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "backend", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date("2024-01-01T00:00:05.000Z"),
            lte: new Date("2024-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.id).toBe("skill-1");
    });

    it("respects a custom window size", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2024-01-01T00:00:10.000Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "backend", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date("2024-01-01T00:00:09.000Z"),
            lte: new Date("2024-01-01T00:00:11.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries for non-archived skills in the repo", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const result = await repo.findActiveByRepo("org/repo");
      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills in the repo", async () => {
      prisma.agentSkill.count.mockResolvedValue(4);
      const result = await repo.countActiveByRepo("org/repo");
      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("queries ordered by utilityScore then lastUsedAt ascending", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill({ id: "low-util" }));
      const result = await repo.findLowestUtilityActive("org/repo");
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.id).toBe("low-util");
    });

    it("returns null when there are no active skills", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const result = await repo.findLowestUtilityActive("org/repo");
      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("updates archivedAt to a Date", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      await repo.archiveById("skill-1");
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills against the query and returns the top k as SkillDocuments", async () => {
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "backend",
        skillMarkdown: "fix the flaky database connection pool timeout",
        name: "DB fix",
        description: "database connection pool fix",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "frontend",
        skillMarkdown: "unrelated css styling notes",
        name: "CSS",
        description: "styling",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);

      const result = await repo.findTopKByRelevance(
        "org/repo",
        "database connection pool timeout",
        1,
      );

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("relevant");
    });

    it("caps k at env.MAX_SKILLS_INJECTED", async () => {
      const skills = Array.from({ length: 8 }, (_, i) =>
        makeSkill({ id: `s${i}`, skillMarkdown: `skill number ${i} markdown content` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("org/repo", "skill markdown", 100);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);
      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ successCount: 3, utilityScore: 3 / 5 }),
      );

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / 5,
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
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ failureCount: 2, utilityScore: 2 / 5 }),
      );

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore < 0.2 and totalUses >= 5", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is not below 0.2", async () => {
      const skill = makeSkill({ utilityScore: 0.5, successCount: 3, failureCount: 3 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when totalUses is below 5, even with low utilityScore", async () => {
      const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 1 });

      await repo.archiveIfLowUtility(skill as never);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one inside a transaction", async () => {
      const lowest = makeSkill({ id: "lowest-util" });
      const created = makeSkill({ id: "new-skill" });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "New Skill",
        description: "desc",
        taskCategory: "backend",
        skillMarkdown: "md",
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest-util" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "New Skill",
          description: "desc",
          taskCategory: "backend",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "lowest-util" });
    });

    it("throws when there are no active skills to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "New Skill",
          description: "desc",
          taskCategory: "backend",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
