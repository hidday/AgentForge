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
    repoSlug: "acme/repo",
    name: "do-thing",
    description: "does a thing",
    taskCategory: "bugfix",
    skillMarkdown: "# do the thing\nsteps...",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
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
    ...overrides,
  };
  const prisma = {
    agentSkill,
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  return prisma as unknown as PrismaClient & { agentSkill: typeof agentSkill };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument, preserving fields", () => {
    const skill = makeSkill({ name: null, description: null });
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: skill.id,
      repoSlug: skill.repoSlug,
      name: null,
      description: null,
      taskCategory: skill.taskCategory,
      skillMarkdown: skill.skillMarkdown,
      utilityScore: skill.utilityScore,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository.create", () => {
  it("creates with zeroed counters/score regardless of caller input", async () => {
    const prisma = makePrisma();
    const created = makeSkill();
    prisma.agentSkill.create.mockResolvedValue(created);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.create({
      repoSlug: "acme/repo",
      name: "do-thing",
      description: "does a thing",
      taskCategory: "bugfix",
      skillMarkdown: "# md",
    });

    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: {
        repoSlug: "acme/repo",
        name: "do-thing",
        description: "does a thing",
        taskCategory: "bugfix",
        skillMarkdown: "# md",
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
    const prisma = makePrisma();
    const skill = makeSkill();
    prisma.agentSkill.findUnique.mockResolvedValue(skill);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findById("skill-1");

    expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    expect(result).toBe(skill);
  });

  it("returns null when not found", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findUnique.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findById("missing");

    expect(result).toBeNull();
  });
});

describe("AgentSkillRepository.findByRepoCategoryNearTime", () => {
  it("queries with a +/- 5s window by default", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma);
    const around = new Date("2024-06-01T12:00:00.000Z");

    await repo.findByRepoCategoryNearTime("acme/repo", "bugfix", around);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "acme/repo",
        taskCategory: "bugfix",
        createdAt: {
          gte: new Date("2024-06-01T11:59:55.000Z"),
          lte: new Date("2024-06-01T12:00:05.000Z"),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("honors a custom windowMs", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma);
    const around = new Date("2024-06-01T12:00:00.000Z");

    await repo.findByRepoCategoryNearTime("acme/repo", "bugfix", around, 1000);

    const call = prisma.agentSkill.findFirst.mock.calls[0][0];
    expect(call.where.createdAt).toEqual({
      gte: new Date("2024-06-01T11:59:59.000Z"),
      lte: new Date("2024-06-01T12:00:01.000Z"),
    });
  });
});

describe("AgentSkillRepository.findActiveByRepo / countActiveByRepo / findLowestUtilityActive", () => {
  it("findActiveByRepo filters archivedAt: null", async () => {
    const prisma = makePrisma();
    const skills = [makeSkill()];
    prisma.agentSkill.findMany.mockResolvedValue(skills);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findActiveByRepo("acme/repo");

    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "acme/repo", archivedAt: null },
    });
    expect(result).toBe(skills);
  });

  it("countActiveByRepo filters archivedAt: null", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.count.mockResolvedValue(3);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.countActiveByRepo("acme/repo");

    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "acme/repo", archivedAt: null },
    });
    expect(result).toBe(3);
  });

  it("findLowestUtilityActive orders by utilityScore asc then lastUsedAt asc", async () => {
    const prisma = makePrisma();
    const skill = makeSkill();
    prisma.agentSkill.findFirst.mockResolvedValue(skill);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findLowestUtilityActive("acme/repo");

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "acme/repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
    expect(result).toBe(skill);
  });
});

describe("AgentSkillRepository.archiveById", () => {
  it("sets archivedAt to a Date on the given id", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
    const repo = new AgentSkillRepository(prisma);

    await repo.archiveById("skill-1");

    expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
    const call = prisma.agentSkill.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "skill-1" });
    expect(call.data.archivedAt).toBeInstanceOf(Date);
  });
});

describe("AgentSkillRepository.findTopKByRelevance", () => {
  it("ranks active skills by relevance and returns mapped documents, best first", async () => {
    const prisma = makePrisma();
    const irrelevant = makeSkill({
      id: "s-irrelevant",
      taskCategory: "totally-unrelated-zzz",
      skillMarkdown: "nothing to do with the query at all qqq",
    });
    const relevant = makeSkill({
      id: "s-relevant",
      taskCategory: "database migration",
      skillMarkdown: "how to run a database migration safely",
    });
    prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findTopKByRelevance("acme/repo", "database migration", 5);

    expect(result[0].id).toBe("s-relevant");
    expect(result.every((d) => "utilityScore" in d)).toBe(true);
  });

  it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
    const prisma = makePrisma();
    const skills = Array.from({ length: 8 }, (_, i) =>
      makeSkill({ id: `s-${i}`, taskCategory: `category ${i}` }),
    );
    prisma.agentSkill.findMany.mockResolvedValue(skills);
    const repo = new AgentSkillRepository(prisma);

    // env.MAX_SKILLS_INJECTED default is 3, but caller asks for 20.
    const result = await repo.findTopKByRelevance("acme/repo", "category 1", 20);

    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("returns an empty array when there are no active skills", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findMany.mockResolvedValue([]);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.findTopKByRelevance("acme/repo", "anything", 5);

    expect(result).toEqual([]);
  });
});

describe("AgentSkillRepository.incrementSuccess / incrementFailure", () => {
  it("incrementSuccess bumps successCount and recomputes utilityScore inside a transaction", async () => {
    const prisma = makePrisma();
    const existing = makeSkill({ successCount: 2, failureCount: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
    prisma.agentSkill.findUniqueOrThrow = findUniqueOrThrow;
    const updated = makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
    prisma.agentSkill.update.mockResolvedValue(updated);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.incrementSuccess("skill-1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        successCount: 3,
        utilityScore: 3 / (3 + 1 + 1),
        lastUsedAt: expect.any(Date),
      },
    });
    expect(result).toBe(updated);
  });

  it("incrementFailure bumps failureCount and recomputes utilityScore inside a transaction", async () => {
    const prisma = makePrisma();
    const existing = makeSkill({ successCount: 4, failureCount: 0 });
    prisma.agentSkill.findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
    const updated = makeSkill({ successCount: 4, failureCount: 1 });
    prisma.agentSkill.update.mockResolvedValue(updated);
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.incrementFailure("skill-1");

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        failureCount: 1,
        utilityScore: 4 / (4 + 1 + 1),
        lastUsedAt: expect.any(Date),
      },
    });
    expect(result).toBe(updated);
  });
});

describe("AgentSkillRepository.archiveIfLowUtility", () => {
  it("archives when utilityScore is below 0.2 and total uses is at least 5 (boundary: exactly 5)", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.update.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma);
    const skill = makeSkill({ utilityScore: 0.1, successCount: 2, failureCount: 3 });

    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: skill.id },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("does not archive when utilityScore is exactly 0.2 (boundary)", async () => {
    const prisma = makePrisma();
    const repo = new AgentSkillRepository(prisma);
    const skill = makeSkill({ utilityScore: 0.2, successCount: 3, failureCount: 3 });

    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });

  it("does not archive when total uses is below 5, even with low utility", async () => {
    const prisma = makePrisma();
    const repo = new AgentSkillRepository(prisma);
    const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 3 });

    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });
});

describe("AgentSkillRepository.displaceAndCreate", () => {
  it("archives the lowest-utility active skill and creates the new one in a transaction", async () => {
    const prisma = makePrisma();
    const lowest = makeSkill({ id: "lowest", utilityScore: 0.01 });
    const findFirst = vi.fn().mockResolvedValue(lowest);
    const update = vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() });
    const create = vi.fn().mockResolvedValue(makeSkill({ id: "new-skill" }));
    prisma.agentSkill.findFirst = findFirst;
    prisma.agentSkill.update = update;
    prisma.agentSkill.create = create;
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.displaceAndCreate("acme/repo", {
      name: "new-skill",
      description: "desc",
      taskCategory: "bugfix",
      skillMarkdown: "# md",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "acme/repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "lowest" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        repoSlug: "acme/repo",
        name: "new-skill",
        description: "desc",
        taskCategory: "bugfix",
        skillMarkdown: "# md",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      },
    });
    expect(result.displacedSkillId).toBe("lowest");
    expect(result.newSkill.id).toBe("new-skill");
  });

  it("throws when there is no active skill to displace", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst = vi.fn().mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma);

    await expect(
      repo.displaceAndCreate("acme/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "bugfix",
        skillMarkdown: "# md",
      }),
    ).rejects.toThrow(/No active skills found for repo acme\/repo/);
  });
});
