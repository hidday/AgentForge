import { describe, it, expect, vi } from "vitest";
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
    name: "retry-logic",
    description: "How to implement retries",
    taskCategory: "backend",
    skillMarkdown: "# Retry logic\nUse exponential backoff.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function makeTx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      ...overrides,
    },
  };
}

function makePrisma(overrides: Partial<Record<string, unknown>> = {}, tx = makeTx()) {
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      ...overrides,
    },
    $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument with only the document fields", () => {
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
    it("creates a skill with zeroed counters and utility score", async () => {
      const created = makeSkill();
      const prisma = makePrisma({ create: vi.fn().mockResolvedValue(created) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "retry-logic",
        description: "How to implement retries",
        taskCategory: "backend",
        skillMarkdown: "# Retry logic",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "retry-logic",
          description: "How to implement retries",
          taskCategory: "backend",
          skillMarkdown: "# Retry logic",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual(created);
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const skill = makeSkill({ id: "skill-42" });
      const prisma = makePrisma({ findUnique: vi.fn().mockResolvedValue(skill) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("skill-42");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-42" } });
      expect(result).toEqual(skill);
    });

    it("returns null when not found", async () => {
      const prisma = makePrisma({ findUnique: vi.fn().mockResolvedValue(null) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s time window around the given time", async () => {
      const skill = makeSkill();
      const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(skill) });
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-02-01T00:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "backend", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(skill);
    });

    it("honors a custom window size", async () => {
      const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
      const repo = new AgentSkillRepository(prisma);
      const around = new Date("2026-02-01T00:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "backend", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date(around.getTime() - 1000),
            lte: new Date(around.getTime() + 1000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries non-archived skills for the given repo", async () => {
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue(skills) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toEqual(skills);
    });

    it("returns an empty array when the repo has no active skills", async () => {
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("org/repo");

      expect(result).toEqual([]);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the given repo", async () => {
      const prisma = makePrisma({ count: vi.fn().mockResolvedValue(7) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("queries non-archived skills ordered by lowest utility then least recently used", async () => {
      const skill = makeSkill({ utilityScore: 0.1 });
      const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(skill) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toEqual(skill);
    });

    it("returns null when there are no active skills", async () => {
      const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time", async () => {
      const prisma = makePrisma({ update: vi.fn().mockResolvedValue(makeSkill()) });
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query and returns top k as documents", async () => {
      const relevantSkill = makeSkill({
        id: "relevant",
        taskCategory: "database migrations",
        skillMarkdown: "How to safely run database migrations in production.",
      });
      const irrelevantSkill = makeSkill({
        id: "irrelevant",
        taskCategory: "frontend styling",
        skillMarkdown: "How to center a div with flexbox.",
      });
      const prisma = makePrisma({
        findMany: vi.fn().mockResolvedValue([irrelevantSkill, relevantSkill]),
      });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "database migrations", 1);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("relevant");
    });

    it("caps results at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const skills = Array.from({ length: 5 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: "backend", skillMarkdown: "backend work" }),
      );
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue(skills) });
      const repo = new AgentSkillRepository(prisma);

      // env.MAX_SKILLS_INJECTED defaults to 3, so asking for 10 must still cap at 3.
      const result = await repo.findTopKByRelevance("org/repo", "backend", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when the repo has no active skills", async () => {
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount, recomputes utilityScore, and bumps lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
      const tx = makeTx({
        findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      });
      const prisma = makePrisma({}, tx);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(updated);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount, recomputes utilityScore, and bumps lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 2, failureCount: 2, utilityScore: 2 / 5 });
      const tx = makeTx({
        findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      });
      const prisma = makePrisma({}, tx);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementFailure("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utility is below 0.2 and total uses are at least 5", async () => {
      const prisma = makePrisma({ update: vi.fn().mockResolvedValue(makeSkill()) });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "low-util", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-util" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is at or above the 0.2 threshold", async () => {
      const prisma = makePrisma({ update: vi.fn() });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "ok-util", utilityScore: 0.5, successCount: 5, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses are below 5, even if utility is low", async () => {
      const prisma = makePrisma({ update: vi.fn() });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "few-uses", utilityScore: 0.1, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new skill inside a transaction", async () => {
      const lowestUtility = makeSkill({ id: "lowest", utilityScore: 0.01 });
      const newSkill = makeSkill({ id: "new-skill", name: "new-name" });
      const tx = makeTx({
        findFirst: vi.fn().mockResolvedValue(lowestUtility),
        update: vi.fn().mockResolvedValue({ ...lowestUtility, archivedAt: new Date() }),
        create: vi.fn().mockResolvedValue(newSkill),
      });
      const prisma = makePrisma({}, tx);
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-name",
        description: "new description",
        taskCategory: "backend",
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
          name: "new-name",
          description: "new description",
          taskCategory: "backend",
          skillMarkdown: "# New skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "lowest" });
    });

    it("throws when there are no active skills to displace for the repo", async () => {
      const tx = makeTx({ findFirst: vi.fn().mockResolvedValue(null) });
      const prisma = makePrisma({}, tx);
      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-name",
          description: "new description",
          taskCategory: "backend",
          skillMarkdown: "# New skill",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
