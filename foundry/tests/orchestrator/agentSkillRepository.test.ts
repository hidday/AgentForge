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
    name: "Use OAuth2",
    description: "How to wire up OAuth2 auth",
    taskCategory: "auth",
    skillMarkdown: "Always use OAuth2 flows for authentication, never raw API keys.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    archivedAt: null,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  } as AgentSkill;
}

function buildRepo() {
  const agentSkill = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  const prisma = {
    agentSkill,
    $transaction: vi.fn(async (cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
  };
  const repo = new AgentSkillRepository(prisma as never);
  return { repo, prisma, agentSkill };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: "skill-1",
      repoSlug: "test-repo",
      name: "Use OAuth2",
      description: "How to wire up OAuth2 auth",
      taskCategory: "auth",
      skillMarkdown: skill.skillMarkdown,
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository.create", () => {
  it("creates a skill with zeroed counters and utility score", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.create.mockResolvedValue(makeSkill());

    await repo.create({
      repoSlug: "test-repo",
      name: "Use OAuth2",
      description: "desc",
      taskCategory: "auth",
      skillMarkdown: "md",
    });

    expect(agentSkill.create).toHaveBeenCalledWith({
      data: {
        repoSlug: "test-repo",
        name: "Use OAuth2",
        description: "desc",
        taskCategory: "auth",
        skillMarkdown: "md",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      },
    });
  });
});

describe("AgentSkillRepository.findById", () => {
  it("returns the skill when found", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.findUnique.mockResolvedValue(makeSkill());
    expect((await repo.findById("skill-1"))?.id).toBe("skill-1");
    expect(agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
  });

  it("returns null when not found", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.findUnique.mockResolvedValue(null);
    expect(await repo.findById("missing")).toBeNull();
  });
});

describe("AgentSkillRepository.findByRepoCategoryNearTime", () => {
  it("queries with a time window derived from the default windowMs", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.findFirst.mockResolvedValue(makeSkill());
    const around = new Date("2024-06-01T12:00:00Z");

    await repo.findByRepoCategoryNearTime("test-repo", "auth", around);

    expect(agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "test-repo",
        taskCategory: "auth",
        createdAt: {
          gte: new Date(around.getTime() - 5000),
          lte: new Date(around.getTime() + 5000),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("honours a custom windowMs", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.findFirst.mockResolvedValue(null);
    const around = new Date("2024-06-01T12:00:00Z");

    const result = await repo.findByRepoCategoryNearTime("test-repo", "auth", around, 1000);

    expect(agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "test-repo",
        taskCategory: "auth",
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

describe("AgentSkillRepository.findActiveByRepo / countActiveByRepo", () => {
  it("findActiveByRepo filters to non-archived skills for the repo", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.findMany.mockResolvedValue([makeSkill()]);

    const skills = await repo.findActiveByRepo("test-repo");

    expect(agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "test-repo", archivedAt: null },
    });
    expect(skills).toHaveLength(1);
  });

  it("countActiveByRepo returns the count", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.count.mockResolvedValue(4);

    expect(await repo.countActiveByRepo("test-repo")).toBe(4);
    expect(agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "test-repo", archivedAt: null },
    });
  });
});

describe("AgentSkillRepository.findLowestUtilityActive", () => {
  it("orders by utilityScore asc then lastUsedAt asc", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.findFirst.mockResolvedValue(makeSkill({ id: "lowest" }));

    const skill = await repo.findLowestUtilityActive("test-repo");

    expect(agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "test-repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
    expect(skill?.id).toBe("lowest");
  });

  it("returns null when there are no active skills", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.findFirst.mockResolvedValue(null);
    expect(await repo.findLowestUtilityActive("test-repo")).toBeNull();
  });
});

describe("AgentSkillRepository.archiveById", () => {
  it("sets archivedAt to a Date", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));

    await repo.archiveById("skill-1");

    expect(agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });
});

describe("AgentSkillRepository.findTopKByRelevance", () => {
  it("scores, sorts descending by relevance, and slices to k", async () => {
    const { repo, agentSkill } = buildRepo();
    const relevant = makeSkill({
      id: "relevant",
      taskCategory: "oauth-migration",
      skillMarkdown: "oauth2 migration checklist for the payments service",
    });
    const irrelevant = makeSkill({
      id: "irrelevant",
      taskCategory: "unrelated-topic",
      skillMarkdown: "completely different subject matter about printer drivers",
    });
    agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);

    const docs = await repo.findTopKByRelevance("test-repo", "oauth2 migration payments", 1);

    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe("relevant");
  });

  it("caps k at the configured MAX_SKILLS_INJECTED (env default is 3)", async () => {
    const { repo, agentSkill } = buildRepo();
    const skills = Array.from({ length: 5 }, (_, i) =>
      makeSkill({ id: `skill-${i}`, skillMarkdown: `topic ${i} about widgets`, taskCategory: `cat${i}` }),
    );
    agentSkill.findMany.mockResolvedValue(skills);

    const docs = await repo.findTopKByRelevance("test-repo", "widgets", 10);

    expect(docs.length).toBeLessThanOrEqual(3);
  });

  it("returns an empty array when there are no active skills", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.findMany.mockResolvedValue([]);

    const docs = await repo.findTopKByRelevance("test-repo", "anything", 3);
    expect(docs).toEqual([]);
  });
});

describe("AgentSkillRepository.incrementSuccess", () => {
  it("increments successCount and recomputes utilityScore inside a transaction", async () => {
    const { repo, agentSkill, prisma } = buildRepo();
    const existing = makeSkill({ successCount: 2, failureCount: 1 });
    agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
    agentSkill.update.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...existing, ...args.data }),
    );

    const updated = await repo.incrementSuccess("skill-1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        successCount: 3,
        utilityScore: 3 / (3 + 1 + 1),
        lastUsedAt: expect.any(Date),
      },
    });
    expect(updated.successCount).toBe(3);
  });
});

describe("AgentSkillRepository.incrementFailure", () => {
  it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
    const { repo, agentSkill } = buildRepo();
    const existing = makeSkill({ successCount: 2, failureCount: 1 });
    agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
    agentSkill.update.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...existing, ...args.data }),
    );

    const updated = await repo.incrementFailure("skill-1");

    expect(agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        failureCount: 2,
        utilityScore: 2 / (2 + 2 + 1),
        lastUsedAt: expect.any(Date),
      },
    });
    expect(updated.failureCount).toBe(2);
  });
});

describe("AgentSkillRepository.archiveIfLowUtility", () => {
  it("archives when utility is below 0.2 and total uses is at least 5", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.update.mockResolvedValue(makeSkill());

    await repo.archiveIfLowUtility(makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 }));

    expect(agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("does not archive when utility is at or above 0.2", async () => {
    const { repo, agentSkill } = buildRepo();

    await repo.archiveIfLowUtility(makeSkill({ utilityScore: 0.2, successCount: 1, failureCount: 4 }));

    expect(agentSkill.update).not.toHaveBeenCalled();
  });

  it("does not archive when total uses is below 5, even with low utility", async () => {
    const { repo, agentSkill } = buildRepo();

    await repo.archiveIfLowUtility(makeSkill({ utilityScore: 0.05, successCount: 0, failureCount: 2 }));

    expect(agentSkill.update).not.toHaveBeenCalled();
  });
});

describe("AgentSkillRepository.displaceAndCreate", () => {
  it("archives the lowest-utility skill and creates the new one in a transaction", async () => {
    const { repo, agentSkill, prisma } = buildRepo();
    const lowest = makeSkill({ id: "lowest", utilityScore: 0.05 });
    agentSkill.findFirst.mockResolvedValue(lowest);
    agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
    agentSkill.create.mockResolvedValue(makeSkill({ id: "new-skill" }));

    const result = await repo.displaceAndCreate("test-repo", {
      name: "New skill",
      description: "desc",
      taskCategory: "auth",
      skillMarkdown: "md",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(agentSkill.update).toHaveBeenCalledWith({
      where: { id: "lowest" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(agentSkill.create).toHaveBeenCalledWith({
      data: {
        repoSlug: "test-repo",
        name: "New skill",
        description: "desc",
        taskCategory: "auth",
        skillMarkdown: "md",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      },
    });
    expect(result.displacedSkillId).toBe("lowest");
    expect(result.newSkill.id).toBe("new-skill");
  });

  it("throws when there are no active skills to displace", async () => {
    const { repo, agentSkill } = buildRepo();
    agentSkill.findFirst.mockResolvedValue(null);

    await expect(
      repo.displaceAndCreate("test-repo", {
        name: "New skill",
        description: "desc",
        taskCategory: "auth",
        skillMarkdown: "md",
      }),
    ).rejects.toThrow(/No active skills found/);
    expect(agentSkill.create).not.toHaveBeenCalled();
  });
});
