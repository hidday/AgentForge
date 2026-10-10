import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import { env } from "../../src/config/env.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "fix-flaky-tests",
    description: "Fixes flaky tests",
    taskCategory: "testing",
    skillMarkdown: "# Fix flaky tests\nRetry and stabilize.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as unknown as AgentSkill;
}

function makePrisma(overrides: {
  agentSkill?: Record<string, unknown>;
  tx?: Record<string, unknown>;
} = {}) {
  const txAgentSkill = {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    ...overrides.tx,
  };

  const prisma = {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      ...overrides.agentSkill,
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({ agentSkill: txAgentSkill })),
  } as unknown as PrismaClient;

  return { prisma, txAgentSkill };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill);

    expect(doc).toEqual({
      id: "skill-1",
      repoSlug: "org/repo",
      name: "fix-flaky-tests",
      description: "Fixes flaky tests",
      taskCategory: "testing",
      skillMarkdown: "# Fix flaky tests\nRetry and stabilize.",
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates a skill with zeroed counters and score", async () => {
      const created = makeSkill({ utilityScore: 0, successCount: 0, failureCount: 0 });
      const create = vi.fn().mockResolvedValue(created);
      const { prisma } = makePrisma({ agentSkill: { create } });

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.create({
        repoSlug: "org/repo",
        name: "fix-flaky-tests",
        description: "Fixes flaky tests",
        taskCategory: "testing",
        skillMarkdown: "# md",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "fix-flaky-tests",
          description: "Fixes flaky tests",
          taskCategory: "testing",
          skillMarkdown: "# md",
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
      const skill = makeSkill();
      const findUnique = vi.fn().mockResolvedValue(skill);
      const { prisma } = makePrisma({ agentSkill: { findUnique } });

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findById("skill-1");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const { prisma } = makePrisma({ agentSkill: { findUnique } });

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5000ms window", async () => {
      const skill = makeSkill();
      const findFirst = vi.fn().mockResolvedValue(skill);
      const { prisma } = makePrisma({ agentSkill: { findFirst } });
      const around = new Date("2026-01-01T00:00:10.000Z");

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findByRepoCategoryNearTime("org/repo", "testing", around);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "testing",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("honors a custom windowMs", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const { prisma } = makePrisma({ agentSkill: { findFirst } });
      const around = new Date("2026-01-01T00:00:10.000Z");

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findByRepoCategoryNearTime("org/repo", "testing", around, 1000);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "testing",
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
    it("queries non-archived skills for the repo", async () => {
      const skills = [makeSkill()];
      const findMany = vi.fn().mockResolvedValue(skills);
      const { prisma } = makePrisma({ agentSkill: { findMany } });

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findActiveByRepo("org/repo");

      expect(findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the count of active skills", async () => {
      const count = vi.fn().mockResolvedValue(7);
      const { prisma } = makePrisma({ agentSkill: { count } });

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.countActiveByRepo("org/repo");

      expect(count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("queries sorted by utilityScore asc then lastUsedAt asc", async () => {
      const skill = makeSkill();
      const findFirst = vi.fn().mockResolvedValue(skill);
      const { prisma } = makePrisma({ agentSkill: { findFirst } });

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findLowestUtilityActive("org/repo");

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when no active skill exists", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const { prisma } = makePrisma({ agentSkill: { findFirst } });

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a new date", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const { prisma } = makePrisma({ agentSkill: { update } });

      const repo = new AgentSkillRepository(prisma);
      await repo.archiveById("skill-1");

      expect(update).toHaveBeenCalledTimes(1);
      const call = update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills and returns the top k sorted by score descending", async () => {
      const skillA = makeSkill({
        id: "a",
        taskCategory: "testing",
        skillMarkdown: "fix flaky tests in ci pipeline",
        name: "fix-flaky",
        description: "flaky test fixer",
      });
      const skillB = makeSkill({
        id: "b",
        taskCategory: "docs",
        skillMarkdown: "update the readme documentation",
        name: "update-docs",
        description: "doc updater",
      });
      const findMany = vi.fn().mockResolvedValue([skillB, skillA]);
      const { prisma } = makePrisma({ agentSkill: { findMany } });

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findTopKByRelevance("org/repo", "fix flaky tests", 1);

      expect(findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = Array.from({ length: env.MAX_SKILLS_INJECTED + 5 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: `category-${i}` }),
      );
      const findMany = vi.fn().mockResolvedValue(skills);
      const { prisma } = makePrisma({ agentSkill: { findMany } });

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findTopKByRelevance("org/repo", "some query", 999);

      expect(result).toHaveLength(env.MAX_SKILLS_INJECTED);
    });

    it("returns an empty array when there are no active skills", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const { prisma } = makePrisma({ agentSkill: { findMany } });

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 1, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const { prisma, txAgentSkill } = makePrisma();
      (txAgentSkill.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
      (txAgentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.incrementSuccess("skill-1");

      expect(txAgentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(txAgentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 2,
          utilityScore: 2 / (2 + 1 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 1, failureCount: 1 });
      const updated = makeSkill({ id: "skill-1", successCount: 1, failureCount: 2 });
      const { prisma, txAgentSkill } = makePrisma();
      (txAgentSkill.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
      (txAgentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.incrementFailure("skill-1");

      expect(txAgentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(txAgentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 1 / (1 + 2 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utilityScore < 0.2 and totalUses >= 5", async () => {
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.1, successCount: 2, failureCount: 3 });
      const update = vi.fn().mockResolvedValue(skill);
      const { prisma } = makePrisma({ agentSkill: { update } });

      const repo = new AgentSkillRepository(prisma);
      await repo.archiveIfLowUtility(skill);

      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0][0].where).toEqual({ id: "skill-1" });
    });

    it("does not archive when utilityScore is high even with many uses", async () => {
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.5, successCount: 5, failureCount: 5 });
      const update = vi.fn();
      const { prisma } = makePrisma({ agentSkill: { update } });

      const repo = new AgentSkillRepository(prisma);
      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });

    it("does not archive when utilityScore is low but totalUses < 5", async () => {
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.05, successCount: 1, failureCount: 1 });
      const update = vi.fn();
      const { prisma } = makePrisma({ agentSkill: { update } });

      const repo = new AgentSkillRepository(prisma);
      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a new one in a transaction", async () => {
      const lowest = makeSkill({ id: "lowest", utilityScore: 0.01 });
      const created = makeSkill({ id: "new-skill" });
      const { prisma, txAgentSkill } = makePrisma();
      (txAgentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(lowest);
      (txAgentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "# md",
      });

      expect(txAgentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(txAgentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(txAgentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "lowest" });
    });

    it("throws when no active skills exist to displace", async () => {
      const { prisma, txAgentSkill } = makePrisma();
      (txAgentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");
      expect(txAgentSkill.update).not.toHaveBeenCalled();
      expect(txAgentSkill.create).not.toHaveBeenCalled();
    });
  });
});
