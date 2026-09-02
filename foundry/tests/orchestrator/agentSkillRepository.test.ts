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
    name: "do-the-thing",
    description: "Does the thing",
    taskCategory: "testing",
    skillMarkdown: "# Do the thing\nSteps to do the thing.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      ...(overrides.agentSkill as Record<string, unknown> | undefined),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn((overrides.tx as object) ?? {})),
    ...overrides,
  } as unknown as PrismaClient;
}

describe("mapAgentSkillToDocument", () => {
  it("maps a skill row to a SkillDocument, preserving fields and dropping counts", () => {
    const skill = makeSkill({
      id: "s-9",
      repoSlug: "org/repo9",
      name: "n",
      description: "d",
      taskCategory: "cat",
      skillMarkdown: "md",
      utilityScore: 0.42,
    });

    const doc = mapAgentSkillToDocument(skill);

    expect(doc).toEqual({
      id: "s-9",
      repoSlug: "org/repo9",
      name: "n",
      description: "d",
      taskCategory: "cat",
      skillMarkdown: "md",
      utilityScore: 0.42,
      lastUsedAt: skill.lastUsedAt,
    });
    expect(doc).not.toHaveProperty("successCount");
    expect(doc).not.toHaveProperty("failureCount");
  });
});

describe("AgentSkillRepository.create", () => {
  it("creates a skill with zeroed counters and returns the created row", async () => {
    const created = makeSkill({ id: "new-id" });
    const prisma = makePrisma({ agentSkill: { create: vi.fn().mockResolvedValue(created) } });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.create({
      repoSlug: "org/repo",
      name: "n",
      description: "d",
      taskCategory: "cat",
      skillMarkdown: "md",
    });

    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: {
        repoSlug: "org/repo",
        name: "n",
        description: "d",
        taskCategory: "cat",
        skillMarkdown: "md",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      },
    });
    expect(result).toBe(created);
  });
});

describe("AgentSkillRepository.findById", () => {
  it("returns the row when found", async () => {
    const skill = makeSkill();
    const prisma = makePrisma({ agentSkill: { findUnique: vi.fn().mockResolvedValue(skill) } });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findById("skill-1");

    expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    expect(result).toBe(skill);
  });

  it("returns null when not found", async () => {
    const prisma = makePrisma({ agentSkill: { findUnique: vi.fn().mockResolvedValue(null) } });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findById("missing");

    expect(result).toBeNull();
  });
});

describe("AgentSkillRepository.findByRepoCategoryNearTime", () => {
  it("queries with a window around the given time using the default window", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ agentSkill: { findFirst } });
    const repo = new AgentSkillRepository(prisma);
    const around = new Date("2026-05-01T12:00:00.000Z");

    await repo.findByRepoCategoryNearTime("org/repo", "cat", around);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "org/repo",
        taskCategory: "cat",
        createdAt: {
          gte: new Date("2026-05-01T11:59:55.000Z"),
          lte: new Date("2026-05-01T12:00:05.000Z"),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("honors a custom windowMs", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ agentSkill: { findFirst } });
    const repo = new AgentSkillRepository(prisma);
    const around = new Date("2026-05-01T12:00:00.000Z");

    await repo.findByRepoCategoryNearTime("org/repo", "cat", around, 1000);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "org/repo",
        taskCategory: "cat",
        createdAt: {
          gte: new Date("2026-05-01T11:59:59.000Z"),
          lte: new Date("2026-05-01T12:00:01.000Z"),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("AgentSkillRepository.findActiveByRepo", () => {
  it("filters by repoSlug and archivedAt null", async () => {
    const skills = [makeSkill()];
    const findMany = vi.fn().mockResolvedValue(skills);
    const prisma = makePrisma({ agentSkill: { findMany } });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findActiveByRepo("org/repo");

    expect(findMany).toHaveBeenCalledWith({ where: { repoSlug: "org/repo", archivedAt: null } });
    expect(result).toBe(skills);
  });
});

describe("AgentSkillRepository.countActiveByRepo", () => {
  it("counts active skills for a repo", async () => {
    const count = vi.fn().mockResolvedValue(7);
    const prisma = makePrisma({ agentSkill: { count } });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.countActiveByRepo("org/repo");

    expect(count).toHaveBeenCalledWith({ where: { repoSlug: "org/repo", archivedAt: null } });
    expect(result).toBe(7);
  });
});

describe("AgentSkillRepository.findLowestUtilityActive", () => {
  it("orders by utilityScore then lastUsedAt ascending", async () => {
    const skill = makeSkill();
    const findFirst = vi.fn().mockResolvedValue(skill);
    const prisma = makePrisma({ agentSkill: { findFirst } });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findLowestUtilityActive("org/repo");

    expect(findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
    expect(result).toBe(skill);
  });

  it("returns null when no active skills exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ agentSkill: { findFirst } });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findLowestUtilityActive("org/repo");

    expect(result).toBeNull();
  });
});

describe("AgentSkillRepository.archiveById", () => {
  it("sets archivedAt to the current time", async () => {
    const update = vi.fn().mockResolvedValue(makeSkill());
    const prisma = makePrisma({ agentSkill: { update } });
    const repo = new AgentSkillRepository(prisma);

    await repo.archiveById("skill-1");

    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "skill-1" });
    expect(call.data.archivedAt).toBeInstanceOf(Date);
  });
});

describe("AgentSkillRepository.findTopKByRelevance", () => {
  it("scores active skills against the query, sorts by relevance descending, and caps at k", async () => {
    const strong = makeSkill({
      id: "strong",
      taskCategory: "database migration",
      skillMarkdown: "How to run a database migration safely",
    });
    const medium = makeSkill({
      id: "medium",
      taskCategory: "database backup",
      skillMarkdown: "How to back up a database",
    });
    const weak = makeSkill({
      id: "weak",
      taskCategory: "unrelated topic",
      skillMarkdown: "Completely unrelated content about baking bread",
    });
    const findMany = vi.fn().mockResolvedValue([weak, strong, medium]);
    const prisma = makePrisma({ agentSkill: { findMany } });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findTopKByRelevance("org/repo", "database migration", 2);

    expect(findMany).toHaveBeenCalledWith({ where: { repoSlug: "org/repo", archivedAt: null } });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("strong");
    expect(result.map((r) => r.id)).not.toContain("weak");
  });

  it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
    const skills = [
      makeSkill({ id: "a", taskCategory: "alpha" }),
      makeSkill({ id: "b", taskCategory: "beta" }),
      makeSkill({ id: "c", taskCategory: "gamma" }),
      makeSkill({ id: "d", taskCategory: "delta" }),
      makeSkill({ id: "e", taskCategory: "epsilon" }),
    ];
    const findMany = vi.fn().mockResolvedValue(skills);
    const prisma = makePrisma({ agentSkill: { findMany } });
    const repo = new AgentSkillRepository(prisma);

    // env.MAX_SKILLS_INJECTED defaults to 3; requesting 10 must still cap at 3.
    const result = await repo.findTopKByRelevance("org/repo", "alpha", 10);

    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("returns an empty array when there are no active skills", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ agentSkill: { findMany } });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findTopKByRelevance("org/repo", "anything", 3);

    expect(result).toEqual([]);
  });
});

describe("AgentSkillRepository.incrementSuccess", () => {
  it("increments successCount, recomputes utilityScore, and bumps lastUsedAt inside a transaction", async () => {
    const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1, utilityScore: 0.5 });
    const updated = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1 });
    const tx = {
      agentSkill: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      },
    };
    const prisma = makePrisma({ tx });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.incrementSuccess("skill-1");

    expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    const updateArgs = tx.agentSkill.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "skill-1" });
    // successCount 2 -> 3; utility = 3 / (3 + 1 + 1) = 0.6
    expect(updateArgs.data.successCount).toBe(3);
    expect(updateArgs.data.utilityScore).toBeCloseTo(0.6);
    expect(updateArgs.data.lastUsedAt).toBeInstanceOf(Date);
    expect(result).toBe(updated);
  });
});

describe("AgentSkillRepository.incrementFailure", () => {
  it("increments failureCount, recomputes utilityScore, and bumps lastUsedAt inside a transaction", async () => {
    const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1, utilityScore: 0.5 });
    const updated = makeSkill({ id: "skill-1", successCount: 2, failureCount: 2 });
    const tx = {
      agentSkill: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      },
    };
    const prisma = makePrisma({ tx });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.incrementFailure("skill-1");

    const updateArgs = tx.agentSkill.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "skill-1" });
    // failureCount 1 -> 2; utility = 2 / (2 + 2 + 1) = 0.4
    expect(updateArgs.data.failureCount).toBe(2);
    expect(updateArgs.data.utilityScore).toBeCloseTo(0.4);
    expect(updateArgs.data.lastUsedAt).toBeInstanceOf(Date);
    expect(result).toBe(updated);
  });
});

describe("AgentSkillRepository.archiveIfLowUtility", () => {
  it("archives when utilityScore is below 0.2 and there have been at least 5 uses", async () => {
    const update = vi.fn().mockResolvedValue(makeSkill());
    const prisma = makePrisma({ agentSkill: { update } });
    const repo = new AgentSkillRepository(prisma);
    const skill = makeSkill({ id: "skill-1", utilityScore: 0.1, successCount: 1, failureCount: 4 });

    await repo.archiveIfLowUtility(skill);

    expect(update).toHaveBeenCalledWith({ where: { id: "skill-1" }, data: { archivedAt: expect.any(Date) } });
  });

  it("does not archive when utilityScore is exactly at the 0.2 boundary", async () => {
    const update = vi.fn();
    const prisma = makePrisma({ agentSkill: { update } });
    const repo = new AgentSkillRepository(prisma);
    const skill = makeSkill({ utilityScore: 0.2, successCount: 1, failureCount: 4 });

    await repo.archiveIfLowUtility(skill);

    expect(update).not.toHaveBeenCalled();
  });

  it("does not archive when total uses are below the 5-use minimum", async () => {
    const update = vi.fn();
    const prisma = makePrisma({ agentSkill: { update } });
    const repo = new AgentSkillRepository(prisma);
    const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 2 });

    await repo.archiveIfLowUtility(skill);

    expect(update).not.toHaveBeenCalled();
  });

  it("archives at exactly the 5-use boundary when utility is low", async () => {
    const update = vi.fn().mockResolvedValue(makeSkill());
    const prisma = makePrisma({ agentSkill: { update } });
    const repo = new AgentSkillRepository(prisma);
    const skill = makeSkill({ id: "skill-5", utilityScore: 0.19, successCount: 2, failureCount: 3 });

    await repo.archiveIfLowUtility(skill);

    expect(update).toHaveBeenCalledWith({ where: { id: "skill-5" }, data: { archivedAt: expect.any(Date) } });
  });
});

describe("AgentSkillRepository.displaceAndCreate", () => {
  it("archives the lowest-utility active skill and creates the new one inside a transaction", async () => {
    const lowestUtility = makeSkill({ id: "lowest" });
    const newSkill = makeSkill({ id: "new-skill" });
    const tx = {
      agentSkill: {
        findFirst: vi.fn().mockResolvedValue(lowestUtility),
        update: vi.fn().mockResolvedValue({ ...lowestUtility, archivedAt: new Date() }),
        create: vi.fn().mockResolvedValue(newSkill),
      },
    };
    const prisma = makePrisma({ tx });
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.displaceAndCreate("org/repo", {
      name: "n",
      description: "d",
      taskCategory: "cat",
      skillMarkdown: "md",
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
        name: "n",
        description: "d",
        taskCategory: "cat",
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
    const prisma = makePrisma({ tx });
    const repo = new AgentSkillRepository(prisma);

    await expect(
      repo.displaceAndCreate("org/repo", {
        name: "n",
        description: "d",
        taskCategory: "cat",
        skillMarkdown: "md",
      }),
    ).rejects.toThrow("No active skills found for repo org/repo to displace");
    expect(tx.agentSkill.update).not.toHaveBeenCalled();
    expect(tx.agentSkill.create).not.toHaveBeenCalled();
  });
});
