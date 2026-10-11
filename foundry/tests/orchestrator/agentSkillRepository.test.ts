import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "fix-flaky-tests",
    description: "Fixes flaky tests in CI",
    taskCategory: "fix flaky test in CI pipeline",
    skillMarkdown: "# Fix flaky tests\nSteps to stabilize flaky CI tests.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(overrides as any),
  } as AgentSkill;
}

function makePrisma(opts: {
  agentSkill?: Record<string, unknown>;
  $transaction?: unknown;
} = {}) {
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      ...(opts.agentSkill ?? {}),
    },
    $transaction: opts.$transaction ?? vi.fn(),
  } as never;
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill to a SkillDocument with the expected fields", () => {
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
      const created = makeSkill({ utilityScore: 0, successCount: 0, failureCount: 0 });
      const create = vi.fn().mockResolvedValue(created);
      const prisma = makePrisma({ agentSkill: { create } });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "fix-flaky-tests",
        description: "desc",
        taskCategory: "category",
        skillMarkdown: "md",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "fix-flaky-tests",
          description: "desc",
          taskCategory: "category",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual(created);
    });

    it("propagates errors from the underlying create call", async () => {
      const create = vi.fn().mockRejectedValue(new Error("insert failed"));
      const prisma = makePrisma({ agentSkill: { create } });
      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.create({
          repoSlug: "org/repo",
          name: "n",
          description: "d",
          taskCategory: "c",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const skill = makeSkill();
      const findUnique = vi.fn().mockResolvedValue(skill);
      const prisma = makePrisma({ agentSkill: { findUnique } });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findById("skill-1");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toEqual(skill);
    });

    it("returns null when not found", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ agentSkill: { findUnique } });
      const repo = new AgentSkillRepository(prisma);

      expect(await repo.findById("missing")).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5000ms window around the given time", async () => {
      const skill = makeSkill();
      const findFirst = vi.fn().mockResolvedValue(skill);
      const prisma = makePrisma({ agentSkill: { findFirst } });
      const repo = new AgentSkillRepository(prisma);

      const around = new Date("2026-01-01T00:00:10Z");
      const result = await repo.findByRepoCategoryNearTime("org/repo", "category", around);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "category",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(skill);
    });

    it("honors a custom windowMs", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ agentSkill: { findFirst } });
      const repo = new AgentSkillRepository(prisma);

      const around = new Date("2026-01-01T00:00:10Z");
      const result = await repo.findByRepoCategoryNearTime("org/repo", "category", around, 1000);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "category",
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
    it("queries non-archived skills for the repo", async () => {
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      const findMany = vi.fn().mockResolvedValue(skills);
      const prisma = makePrisma({ agentSkill: { findMany } });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findActiveByRepo("org/repo");

      expect(findMany).toHaveBeenCalledWith({ where: { repoSlug: "org/repo", archivedAt: null } });
      expect(result.map((s) => s.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when no active skills exist", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ agentSkill: { findMany } });
      const repo = new AgentSkillRepository(prisma);

      expect(await repo.findActiveByRepo("org/repo")).toEqual([]);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      const count = vi.fn().mockResolvedValue(4);
      const prisma = makePrisma({ agentSkill: { count } });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.countActiveByRepo("org/repo");

      expect(count).toHaveBeenCalledWith({ where: { repoSlug: "org/repo", archivedAt: null } });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const skill = makeSkill({ id: "low" });
      const findFirst = vi.fn().mockResolvedValue(skill);
      const prisma = makePrisma({ agentSkill: { findFirst } });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.id).toBe("low");
    });

    it("returns null when there are no active skills", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = makePrisma({ agentSkill: { findFirst } });
      const repo = new AgentSkillRepository(prisma);

      expect(await repo.findLowestUtilityActive("org/repo")).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const prisma = makePrisma({ agentSkill: { update } });
      const repo = new AgentSkillRepository(prisma);

      await repo.archiveById("skill-1");

      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query, highest first", async () => {
      const exactMatch = makeSkill({
        id: "exact",
        taskCategory: "fix flaky test in CI pipeline",
        name: "fix-flaky",
        description: "fixes flaky tests",
        skillMarkdown: "fix flaky test in CI pipeline details",
      });
      const unrelated = makeSkill({
        id: "unrelated",
        taskCategory: "zzz totally unrelated qqq topic",
        name: "zzz-unrelated",
        description: "zzz nothing to do with it qqq",
        skillMarkdown: "zzz qqq xyz nothing shared here at all wwwwww",
      });
      const findMany = vi.fn().mockResolvedValue([unrelated, exactMatch]);
      const prisma = makePrisma({ agentSkill: { findMany } });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "fix flaky test in CI pipeline", 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("exact");
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: "exact",
          repoSlug: "org/repo",
          taskCategory: "fix flaky test in CI pipeline",
        }),
      );
    });

    it("caps the number of returned skills at env.MAX_SKILLS_INJECTED even if k is larger", async () => {
      const { env } = await import("../../src/config/env.js");
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: `category number ${i}` }),
      );
      const findMany = vi.fn().mockResolvedValue(skills);
      const prisma = makePrisma({ agentSkill: { findMany } });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "category number 3", 10);

      expect(result.length).toBeLessThanOrEqual(env.MAX_SKILLS_INJECTED);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("returns an empty array when the repo has no active skills", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = makePrisma({ agentSkill: { findMany } });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
      const update = vi.fn().mockImplementation(({ data }) => ({ ...existing, ...data }));
      const tx = { agentSkill: { findUniqueOrThrow, update } };
      const $transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const prisma = makePrisma({ $transaction });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementSuccess("skill-1");

      expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newSuccessCount = 3, newUtilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 0.6,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
      expect(result.utilityScore).toBe(0.6);
    });

    it("propagates errors raised inside the transaction (e.g. skill not found)", async () => {
      const findUniqueOrThrow = vi.fn().mockRejectedValue(new Error("not found"));
      const tx = { agentSkill: { findUniqueOrThrow, update: vi.fn() } };
      const $transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const prisma = makePrisma({ $transaction });
      const repo = new AgentSkillRepository(prisma);

      await expect(repo.incrementSuccess("missing")).rejects.toThrow("not found");
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
      const update = vi.fn().mockImplementation(({ data }) => ({ ...existing, ...data }));
      const tx = { agentSkill: { findUniqueOrThrow, update } };
      const $transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const prisma = makePrisma({ $transaction });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2, newUtilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 0.4,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
      expect(result.utilityScore).toBe(0.4);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore < 0.2 and total uses >= 5", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const prisma = makePrisma({ agentSkill: { update } });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ id: "low-util", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(update).toHaveBeenCalledWith({
        where: { id: "low-util" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is low but total uses < 5", async () => {
      const update = vi.fn();
      const prisma = makePrisma({ agentSkill: { update } });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });

    it("does not archive when utilityScore is at/above the 0.2 threshold", async () => {
      const update = vi.fn();
      const prisma = makePrisma({ agentSkill: { update } });
      const repo = new AgentSkillRepository(prisma);
      const skill = makeSkill({ utilityScore: 0.2, successCount: 3, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a new one inside a transaction", async () => {
      const lowest = makeSkill({ id: "lowest", utilityScore: 0.05 });
      const newSkill = makeSkill({ id: "new-skill", utilityScore: 0 });
      const findFirst = vi.fn().mockResolvedValue(lowest);
      const update = vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() });
      const create = vi.fn().mockResolvedValue(newSkill);
      const tx = { agentSkill: { findFirst, update, create } };
      const $transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const prisma = makePrisma({ $transaction });
      const repo = new AgentSkillRepository(prisma);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-name",
        description: "new-desc",
        taskCategory: "new-category",
        skillMarkdown: "new markdown",
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-name",
          description: "new-desc",
          taskCategory: "new-category",
          skillMarkdown: "new markdown",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const tx = { agentSkill: { findFirst, update: vi.fn(), create: vi.fn() } };
      const $transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
      const prisma = makePrisma({ $transaction });
      const repo = new AgentSkillRepository(prisma);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "n",
          description: "d",
          taskCategory: "c",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");
    });
  });
});
