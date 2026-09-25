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
    name: "handle-widgets",
    description: "Handles widget tasks",
    taskCategory: "widgets",
    skillMarkdown: "# Widgets\nDo widget things.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function buildPrisma() {
  const tx = {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
    __tx: tx,
  };
}

describe("mapAgentSkillToDocument / toSkillDocument", () => {
  it("projects only the SkillDocument fields from a full AgentSkill row", () => {
    const skill = makeSkill({
      id: "skill-9",
      repoSlug: "org/repo",
      name: "n",
      description: "d",
      taskCategory: "cat",
      skillMarkdown: "md",
      utilityScore: 0.42,
      successCount: 999,
      failureCount: 999,
    });

    const doc = mapAgentSkillToDocument(skill);

    expect(doc).toEqual({
      id: "skill-9",
      repoSlug: "org/repo",
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
  it("creates with zeroed counters/utility regardless of caller input", async () => {
    const prisma = buildPrisma();
    const created = makeSkill({ id: "new-skill" });
    prisma.agentSkill.create.mockResolvedValue(created);

    const repo = new AgentSkillRepository(prisma as never);
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
  it("returns the skill when found", async () => {
    const prisma = buildPrisma();
    const skill = makeSkill();
    prisma.agentSkill.findUnique.mockResolvedValue(skill);

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.findById("skill-1");

    expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    expect(result).toBe(skill);
  });

  it("returns null when not found", async () => {
    const prisma = buildPrisma();
    prisma.agentSkill.findUnique.mockResolvedValue(null);

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.findById("missing");

    expect(result).toBeNull();
  });
});

describe("AgentSkillRepository.findByRepoCategoryNearTime", () => {
  it("queries with a time window around the given date and the default windowMs", async () => {
    const prisma = buildPrisma();
    const skill = makeSkill();
    prisma.agentSkill.findFirst.mockResolvedValue(skill);
    const around = new Date("2026-03-01T12:00:00.000Z");

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.findByRepoCategoryNearTime("org/repo", "widgets", around);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "org/repo",
        taskCategory: "widgets",
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
    const prisma = buildPrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const around = new Date("2026-03-01T12:00:00.000Z");

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.findByRepoCategoryNearTime("org/repo", "widgets", around, 1000);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "org/repo",
        taskCategory: "widgets",
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

describe("AgentSkillRepository.findActiveByRepo", () => {
  it("queries active (non-archived) skills for the repo", async () => {
    const prisma = buildPrisma();
    const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
    prisma.agentSkill.findMany.mockResolvedValue(skills);

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.findActiveByRepo("org/repo");

    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
    expect(result).toBe(skills);
  });
});

describe("AgentSkillRepository.countActiveByRepo", () => {
  it("counts active skills for the repo and returns the number", async () => {
    const prisma = buildPrisma();
    prisma.agentSkill.count.mockResolvedValue(7);

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.countActiveByRepo("org/repo");

    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
    expect(result).toBe(7);
  });
});

describe("AgentSkillRepository.findLowestUtilityActive", () => {
  it("queries ordered by utilityScore asc then lastUsedAt asc", async () => {
    const prisma = buildPrisma();
    const skill = makeSkill({ id: "lowest" });
    prisma.agentSkill.findFirst.mockResolvedValue(skill);

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.findLowestUtilityActive("org/repo");

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
    expect(result).toBe(skill);
  });

  it("returns null when there are no active skills", async () => {
    const prisma = buildPrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(null);

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.findLowestUtilityActive("org/repo");

    expect(result).toBeNull();
  });
});

describe("AgentSkillRepository.archiveById", () => {
  it("updates archivedAt to a Date and resolves void", async () => {
    const prisma = buildPrisma();
    prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.archiveById("skill-1");

    expect(result).toBeUndefined();
    expect(prisma.agentSkill.update).toHaveBeenCalledOnce();
    const call = prisma.agentSkill.update.mock.calls[0][0] as {
      where: { id: string };
      data: { archivedAt: Date };
    };
    expect(call.where).toEqual({ id: "skill-1" });
    expect(call.data.archivedAt).toBeInstanceOf(Date);
  });
});

describe("AgentSkillRepository.findTopKByRelevance", () => {
  it("scores active skills against the query, sorts descending, and caps at k", async () => {
    const prisma = buildPrisma();
    const irrelevant = makeSkill({
      id: "irrelevant",
      name: "unrelated-thing",
      description: "completely different topic",
      taskCategory: "zzz-nomatch",
      skillMarkdown: "totally unrelated content about nothing in particular",
    });
    const relevant = makeSkill({
      id: "relevant",
      name: "widget-handler",
      description: "handles widgets directly",
      taskCategory: "widget handling",
      skillMarkdown: "widget handling widget handling widget handling",
    });
    prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.findTopKByRelevance("org/repo", "widget handling", 1);

    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("relevant");
  });

  it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
    const prisma = buildPrisma();
    const skills = Array.from({ length: 10 }, (_, i) =>
      makeSkill({
        id: `skill-${i}`,
        name: `name-${i}`,
        taskCategory: `category-${i}`,
        skillMarkdown: `markdown content number ${i}`,
      }),
    );
    prisma.agentSkill.findMany.mockResolvedValue(skills);

    const repo = new AgentSkillRepository(prisma as never);
    // env.MAX_SKILLS_INJECTED defaults to 3 (see src/config/env.ts)
    const result = await repo.findTopKByRelevance("org/repo", "irrelevant query xyz", 100);

    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("returns an empty array when there are no active skills", async () => {
    const prisma = buildPrisma();
    prisma.agentSkill.findMany.mockResolvedValue([]);

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.findTopKByRelevance("org/repo", "anything", 5);

    expect(result).toEqual([]);
  });

  it("returns SkillDocument-shaped items, not raw AgentSkill rows", async () => {
    const prisma = buildPrisma();
    const skill = makeSkill({ id: "skill-x", successCount: 5, failureCount: 2 });
    prisma.agentSkill.findMany.mockResolvedValue([skill]);

    const repo = new AgentSkillRepository(prisma as never);
    const [doc] = await repo.findTopKByRelevance("org/repo", "query", 1);

    expect(doc).not.toHaveProperty("successCount");
    expect(doc).not.toHaveProperty("failureCount");
    expect(doc.id).toBe("skill-x");
  });
});

describe("AgentSkillRepository.incrementSuccess", () => {
  it("increments successCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
    const prisma = buildPrisma();
    const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
    prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
    const updated = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
    prisma.__tx.agentSkill.update.mockResolvedValue(updated);

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.incrementSuccess("skill-1");

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.__tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "skill-1" },
    });
    const updateCall = prisma.__tx.agentSkill.update.mock.calls[0][0] as {
      where: { id: string };
      data: { successCount: number; utilityScore: number; lastUsedAt: Date };
    };
    expect(updateCall.where).toEqual({ id: "skill-1" });
    // newSuccessCount = 3, newUtilityScore = 3 / (3 + 1 + 1) = 0.6
    expect(updateCall.data.successCount).toBe(3);
    expect(updateCall.data.utilityScore).toBeCloseTo(0.6);
    expect(updateCall.data.lastUsedAt).toBeInstanceOf(Date);
    expect(result).toBe(updated);
  });

  it("propagates the error when the skill does not exist (findUniqueOrThrow rejects)", async () => {
    const prisma = buildPrisma();
    const notFoundError = new Error("No AgentSkill found");
    prisma.__tx.agentSkill.findUniqueOrThrow.mockRejectedValue(notFoundError);

    const repo = new AgentSkillRepository(prisma as never);

    await expect(repo.incrementSuccess("missing")).rejects.toBe(notFoundError);
    expect(prisma.__tx.agentSkill.update).not.toHaveBeenCalled();
  });
});

describe("AgentSkillRepository.incrementFailure", () => {
  it("increments failureCount, recomputes utilityScore, and updates lastUsedAt inside a transaction", async () => {
    const prisma = buildPrisma();
    const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
    prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
    const updated = makeSkill({ id: "skill-1", successCount: 2, failureCount: 2, utilityScore: 2 / 5 });
    prisma.__tx.agentSkill.update.mockResolvedValue(updated);

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.incrementFailure("skill-1");

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    const updateCall = prisma.__tx.agentSkill.update.mock.calls[0][0] as {
      where: { id: string };
      data: { failureCount: number; utilityScore: number; lastUsedAt: Date };
    };
    expect(updateCall.where).toEqual({ id: "skill-1" });
    // newFailureCount = 2, newUtilityScore = 2 / (2 + 2 + 1) = 0.4
    expect(updateCall.data.failureCount).toBe(2);
    expect(updateCall.data.utilityScore).toBeCloseTo(0.4);
    expect(updateCall.data.lastUsedAt).toBeInstanceOf(Date);
    expect(result).toBe(updated);
  });

  it("propagates the error when the skill does not exist (findUniqueOrThrow rejects)", async () => {
    const prisma = buildPrisma();
    const notFoundError = new Error("No AgentSkill found");
    prisma.__tx.agentSkill.findUniqueOrThrow.mockRejectedValue(notFoundError);

    const repo = new AgentSkillRepository(prisma as never);

    await expect(repo.incrementFailure("missing")).rejects.toBe(notFoundError);
    expect(prisma.__tx.agentSkill.update).not.toHaveBeenCalled();
  });
});

describe("AgentSkillRepository.archiveIfLowUtility", () => {
  it("archives when utilityScore < 0.2 and total uses >= 5", async () => {
    const prisma = buildPrisma();
    prisma.agentSkill.update.mockResolvedValue(makeSkill());

    const repo = new AgentSkillRepository(prisma as never);
    const skill = makeSkill({ id: "low-util", utilityScore: 0.1, successCount: 1, failureCount: 4 });
    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "low-util" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("does not archive when utilityScore is at or above the 0.2 threshold", async () => {
    const prisma = buildPrisma();
    const repo = new AgentSkillRepository(prisma as never);
    const skill = makeSkill({ utilityScore: 0.2, successCount: 3, failureCount: 3 });

    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });

  it("does not archive when total uses are below 5, even with a low utility score", async () => {
    const prisma = buildPrisma();
    const repo = new AgentSkillRepository(prisma as never);
    const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 2 });

    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });
});

describe("AgentSkillRepository.displaceAndCreate", () => {
  it("archives the lowest-utility active skill and creates the new one inside a transaction", async () => {
    const prisma = buildPrisma();
    const lowest = makeSkill({ id: "lowest-skill", utilityScore: 0.01 });
    prisma.__tx.agentSkill.findFirst.mockResolvedValue(lowest);
    const created = makeSkill({ id: "new-skill" });
    prisma.__tx.agentSkill.create.mockResolvedValue(created);
    prisma.__tx.agentSkill.update.mockResolvedValue(
      makeSkill({ id: "lowest-skill", archivedAt: new Date() }),
    );

    const repo = new AgentSkillRepository(prisma as never);
    const result = await repo.displaceAndCreate("org/repo", {
      name: "n",
      description: "d",
      taskCategory: "cat",
      skillMarkdown: "md",
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.__tx.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
    expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "lowest-skill" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(prisma.__tx.agentSkill.create).toHaveBeenCalledWith({
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
    expect(result).toEqual({ newSkill: created, displacedSkillId: "lowest-skill" });
  });

  it("throws when there is no active skill to displace, and never creates the new skill", async () => {
    const prisma = buildPrisma();
    prisma.__tx.agentSkill.findFirst.mockResolvedValue(null);

    const repo = new AgentSkillRepository(prisma as never);

    await expect(
      repo.displaceAndCreate("org/repo", {
        name: "n",
        description: "d",
        taskCategory: "cat",
        skillMarkdown: "md",
      }),
    ).rejects.toThrow("No active skills found for repo org/repo to displace");
    expect(prisma.__tx.agentSkill.create).not.toHaveBeenCalled();
    expect(prisma.__tx.agentSkill.update).not.toHaveBeenCalled();
  });
});
