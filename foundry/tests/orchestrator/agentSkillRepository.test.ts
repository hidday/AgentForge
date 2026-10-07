import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "oauth-setup",
    description: "Sets up OAuth2 flows",
    taskCategory: "auth",
    skillMarkdown: "# OAuth setup\nDo the OAuth dance carefully.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function buildPrismaMock() {
  const tx = {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    agentSkill: tx.agentSkill,
    $transaction: vi.fn(async (cb: (tx: typeof prisma) => unknown) => cb(prisma as never)),
  };
  return prisma;
}

describe("AgentSkillRepository.create", () => {
  it("creates a new skill with zeroed counters and utility score", async () => {
    const prisma = buildPrismaMock();
    const created = makeSkill();
    prisma.agentSkill.create.mockResolvedValue(created);
    const repo = new AgentSkillRepository(prisma as never);

    const result = await repo.create({
      repoSlug: "test-repo",
      name: "oauth-setup",
      description: "Sets up OAuth2 flows",
      taskCategory: "auth",
      skillMarkdown: "# OAuth setup",
    });

    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        repoSlug: "test-repo",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      }),
    });
    expect(result).toBe(created);
  });
});

describe("AgentSkillRepository.findById", () => {
  it("returns the skill when found", async () => {
    const prisma = buildPrismaMock();
    const skill = makeSkill({ id: "skill-7" });
    prisma.agentSkill.findUnique.mockResolvedValue(skill);
    const repo = new AgentSkillRepository(prisma as never);

    expect(await repo.findById("skill-7")).toBe(skill);
    expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-7" } });
  });

  it("returns null when not found", async () => {
    const prisma = buildPrismaMock();
    prisma.agentSkill.findUnique.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma as never);

    expect(await repo.findById("missing")).toBeNull();
  });
});

describe("AgentSkillRepository.findByRepoCategoryNearTime", () => {
  it("queries with a time window of +/- windowMs around `around`", async () => {
    const prisma = buildPrismaMock();
    const skill = makeSkill();
    prisma.agentSkill.findFirst.mockResolvedValue(skill);
    const repo = new AgentSkillRepository(prisma as never);

    const around = new Date("2026-02-01T00:00:00Z");
    await repo.findByRepoCategoryNearTime("test-repo", "auth", around, 2000);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "test-repo",
        taskCategory: "auth",
        createdAt: {
          gte: new Date(around.getTime() - 2000),
          lte: new Date(around.getTime() + 2000),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("defaults the window to 5000ms when not specified", async () => {
    const prisma = buildPrismaMock();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma as never);

    const around = new Date("2026-02-01T00:00:00Z");
    await repo.findByRepoCategoryNearTime("test-repo", "auth", around);

    const callArgs = prisma.agentSkill.findFirst.mock.calls[0][0];
    expect(callArgs.where.createdAt.gte).toEqual(new Date(around.getTime() - 5000));
    expect(callArgs.where.createdAt.lte).toEqual(new Date(around.getTime() + 5000));
  });

  it("returns null when nothing matches", async () => {
    const prisma = buildPrismaMock();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma as never);

    expect(
      await repo.findByRepoCategoryNearTime("test-repo", "auth", new Date()),
    ).toBeNull();
  });
});

describe("AgentSkillRepository.findActiveByRepo", () => {
  it("filters by repoSlug and archivedAt null", async () => {
    const prisma = buildPrismaMock();
    const skills = [makeSkill({ id: "s1" }), makeSkill({ id: "s2" })];
    prisma.agentSkill.findMany.mockResolvedValue(skills);
    const repo = new AgentSkillRepository(prisma as never);

    const result = await repo.findActiveByRepo("test-repo");

    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "test-repo", archivedAt: null },
    });
    expect(result).toEqual(skills);
  });
});

describe("AgentSkillRepository.countActiveByRepo", () => {
  it("counts active skills for a repo", async () => {
    const prisma = buildPrismaMock();
    prisma.agentSkill.count.mockResolvedValue(3);
    const repo = new AgentSkillRepository(prisma as never);

    expect(await repo.countActiveByRepo("test-repo")).toBe(3);
    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "test-repo", archivedAt: null },
    });
  });
});

describe("AgentSkillRepository.findLowestUtilityActive", () => {
  it("orders by utilityScore asc then lastUsedAt asc", async () => {
    const prisma = buildPrismaMock();
    const skill = makeSkill({ id: "lowest" });
    prisma.agentSkill.findFirst.mockResolvedValue(skill);
    const repo = new AgentSkillRepository(prisma as never);

    const result = await repo.findLowestUtilityActive("test-repo");

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "test-repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
    expect(result).toBe(skill);
  });

  it("returns null when no active skills exist", async () => {
    const prisma = buildPrismaMock();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma as never);

    expect(await repo.findLowestUtilityActive("test-repo")).toBeNull();
  });
});

describe("AgentSkillRepository.archiveById", () => {
  it("sets archivedAt to a Date", async () => {
    const prisma = buildPrismaMock();
    prisma.agentSkill.update.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma as never);

    await repo.archiveById("skill-1");

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });
});

describe("AgentSkillRepository.findTopKByRelevance", () => {
  it("ranks active skills by relevance to the query and returns top-k documents", async () => {
    const prisma = buildPrismaMock();
    const relevant = makeSkill({
      id: "relevant",
      taskCategory: "oauth integration",
      skillMarkdown: "OAuth integration flow details and setup steps",
      name: "oauth-setup",
      description: "Handles OAuth integration",
    });
    const irrelevant = makeSkill({
      id: "irrelevant",
      taskCategory: "database migration",
      skillMarkdown: "Totally unrelated database migration notes",
      name: "db-migrate",
      description: "Database schema migration helper",
    });
    prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);
    const repo = new AgentSkillRepository(prisma as never);

    const docs = await repo.findTopKByRelevance("test-repo", "oauth integration setup", 1);

    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe("relevant");
  });

  it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
    const prisma = buildPrismaMock();
    const skills = Array.from({ length: 10 }, (_, i) =>
      makeSkill({ id: `s${i}`, taskCategory: "auth", skillMarkdown: `auth notes ${i}` }),
    );
    prisma.agentSkill.findMany.mockResolvedValue(skills);
    const repo = new AgentSkillRepository(prisma as never);

    const docs = await repo.findTopKByRelevance("test-repo", "auth", 50);

    // env.MAX_SKILLS_INJECTED defaults to 3
    expect(docs.length).toBeLessThanOrEqual(3);
  });

  it("returns an empty array when there are no active skills", async () => {
    const prisma = buildPrismaMock();
    prisma.agentSkill.findMany.mockResolvedValue([]);
    const repo = new AgentSkillRepository(prisma as never);

    expect(await repo.findTopKByRelevance("test-repo", "anything", 3)).toEqual([]);
  });
});

describe("AgentSkillRepository.incrementSuccess", () => {
  it("increments successCount and recomputes utilityScore inside a transaction", async () => {
    const prisma = buildPrismaMock();
    const existing = makeSkill({ successCount: 2, failureCount: 1 });
    prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
    prisma.agentSkill.update.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...existing, ...args.data }),
    );
    const repo = new AgentSkillRepository(prisma as never);

    const updated = await repo.incrementSuccess("skill-1");

    // newSuccessCount = 3, utility = 3 / (3 + 1 + 1) = 0.6
    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        successCount: 3,
        utilityScore: 0.6,
        lastUsedAt: expect.any(Date),
      },
    });
    expect(updated.successCount).toBe(3);
    expect(updated.utilityScore).toBeCloseTo(0.6);
  });
});

describe("AgentSkillRepository.incrementFailure", () => {
  it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
    const prisma = buildPrismaMock();
    const existing = makeSkill({ successCount: 2, failureCount: 1 });
    prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
    prisma.agentSkill.update.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...existing, ...args.data }),
    );
    const repo = new AgentSkillRepository(prisma as never);

    const updated = await repo.incrementFailure("skill-1");

    // newFailureCount = 2, utility = 2 / (2 + 2 + 1) = 0.4
    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        failureCount: 2,
        utilityScore: 0.4,
        lastUsedAt: expect.any(Date),
      },
    });
    expect(updated.failureCount).toBe(2);
    expect(updated.utilityScore).toBeCloseTo(0.4);
  });
});

describe("AgentSkillRepository.archiveIfLowUtility", () => {
  it("archives when utilityScore < 0.2 and totalUses >= 5", async () => {
    const prisma = buildPrismaMock();
    prisma.agentSkill.update.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma as never);

    const skill = makeSkill({ id: "low-util", utilityScore: 0.1, successCount: 1, failureCount: 4 });
    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "low-util" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("does NOT archive when utilityScore is low but totalUses < 5", async () => {
    const prisma = buildPrismaMock();
    const repo = new AgentSkillRepository(prisma as never);

    const skill = makeSkill({ id: "few-uses", utilityScore: 0.05, successCount: 0, failureCount: 2 });
    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });

  it("does NOT archive when utilityScore is at or above the 0.2 threshold", async () => {
    const prisma = buildPrismaMock();
    const repo = new AgentSkillRepository(prisma as never);

    const skill = makeSkill({ id: "ok-util", utilityScore: 0.2, successCount: 3, failureCount: 3 });
    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });
});

describe("AgentSkillRepository.displaceAndCreate", () => {
  it("archives the lowest-utility skill and creates a new one in the same transaction", async () => {
    const prisma = buildPrismaMock();
    const lowest = makeSkill({ id: "lowest", utilityScore: 0.05 });
    const created = makeSkill({ id: "new-skill", name: "new-skill" });
    prisma.agentSkill.findFirst.mockResolvedValue(lowest);
    prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
    prisma.agentSkill.create.mockResolvedValue(created);
    const repo = new AgentSkillRepository(prisma as never);

    const result = await repo.displaceAndCreate("test-repo", {
      name: "new-skill",
      description: "desc",
      taskCategory: "auth",
      skillMarkdown: "# new",
    });

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "lowest" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(result.newSkill).toBe(created);
    expect(result.displacedSkillId).toBe("lowest");
  });

  it("throws when there are no active skills to displace", async () => {
    const prisma = buildPrismaMock();
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma as never);

    await expect(
      repo.displaceAndCreate("test-repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "auth",
        skillMarkdown: "# new",
      }),
    ).rejects.toThrow('No active skills found for repo test-repo to displace');
  });
});

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument with the same field values", () => {
    const skill = makeSkill({ id: "skill-9", name: "foo", description: "bar" });
    const doc = mapAgentSkillToDocument(skill);

    expect(doc).toEqual({
      id: "skill-9",
      repoSlug: skill.repoSlug,
      name: "foo",
      description: "bar",
      taskCategory: skill.taskCategory,
      skillMarkdown: skill.skillMarkdown,
      utilityScore: skill.utilityScore,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});
