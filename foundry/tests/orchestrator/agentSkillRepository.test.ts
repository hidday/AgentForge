import { describe, it, expect, vi } from "vitest";
import { AgentSkillRepository, mapAgentSkillToDocument } from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "Deploy skill",
    description: "How to deploy",
    taskCategory: "deployment",
    skillMarkdown: "# Deploy\nRun the deploy script.",
    utilityScore: 0.5,
    successCount: 1,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
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
      ...overrides,
    },
    $transaction: vi.fn(),
  } as unknown as PrismaClient;
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row onto the SkillDocument shape", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill as never);
    expect(doc).toEqual({
      id: "skill-1",
      repoSlug: "test-repo",
      name: "Deploy skill",
      description: "How to deploy",
      taskCategory: "deployment",
      skillMarkdown: "# Deploy\nRun the deploy script.",
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository.create", () => {
  it("creates a skill with zero initial counts and utility score", async () => {
    const create = vi.fn().mockResolvedValue(makeSkill());
    const prisma = makePrisma({ create });
    const repo = new AgentSkillRepository(prisma);

    await repo.create({
      repoSlug: "test-repo",
      name: "Deploy skill",
      description: "How to deploy",
      taskCategory: "deployment",
      skillMarkdown: "# Deploy",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        repoSlug: "test-repo",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      }),
    });
  });
});

describe("AgentSkillRepository.findById", () => {
  it("returns the skill when found", async () => {
    const findUnique = vi.fn().mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(makePrisma({ findUnique }));

    const skill = await repo.findById("skill-1");

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    expect(skill?.id).toBe("skill-1");
  });

  it("returns null when not found", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const repo = new AgentSkillRepository(makePrisma({ findUnique }));

    expect(await repo.findById("missing")).toBeNull();
  });
});

describe("AgentSkillRepository.findByRepoCategoryNearTime", () => {
  it("queries within the default 5s time window around the given time", async () => {
    const findFirst = vi.fn().mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(makePrisma({ findFirst }));
    const around = new Date("2026-01-01T00:00:10.000Z");

    await repo.findByRepoCategoryNearTime("test-repo", "deployment", around);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "test-repo",
        taskCategory: "deployment",
        createdAt: {
          gte: new Date("2026-01-01T00:00:05.000Z"),
          lte: new Date("2026-01-01T00:00:15.000Z"),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("respects a custom windowMs", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repo = new AgentSkillRepository(makePrisma({ findFirst }));
    const around = new Date("2026-01-01T00:00:10.000Z");

    await repo.findByRepoCategoryNearTime("test-repo", "deployment", around, 1000);

    expect(findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        createdAt: {
          gte: new Date("2026-01-01T00:00:09.000Z"),
          lte: new Date("2026-01-01T00:00:11.000Z"),
        },
      }),
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("AgentSkillRepository.findActiveByRepo", () => {
  it("filters to non-archived skills for the repo", async () => {
    const findMany = vi.fn().mockResolvedValue([makeSkill()]);
    const repo = new AgentSkillRepository(makePrisma({ findMany }));

    const skills = await repo.findActiveByRepo("test-repo");

    expect(findMany).toHaveBeenCalledWith({ where: { repoSlug: "test-repo", archivedAt: null } });
    expect(skills).toHaveLength(1);
  });
});

describe("AgentSkillRepository.countActiveByRepo", () => {
  it("counts non-archived skills for the repo", async () => {
    const count = vi.fn().mockResolvedValue(4);
    const repo = new AgentSkillRepository(makePrisma({ count }));

    const total = await repo.countActiveByRepo("test-repo");

    expect(count).toHaveBeenCalledWith({ where: { repoSlug: "test-repo", archivedAt: null } });
    expect(total).toBe(4);
  });
});

describe("AgentSkillRepository.findLowestUtilityActive", () => {
  it("orders by utilityScore asc then lastUsedAt asc", async () => {
    const findFirst = vi.fn().mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(makePrisma({ findFirst }));

    await repo.findLowestUtilityActive("test-repo");

    expect(findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "test-repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
  });

  it("returns null when there are no active skills", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repo = new AgentSkillRepository(makePrisma({ findFirst }));

    expect(await repo.findLowestUtilityActive("test-repo")).toBeNull();
  });
});

describe("AgentSkillRepository.archiveById", () => {
  it("sets archivedAt to a Date", async () => {
    const update = vi.fn().mockResolvedValue(makeSkill({ archivedAt: new Date() }));
    const repo = new AgentSkillRepository(makePrisma({ update }));

    await repo.archiveById("skill-1");

    expect(update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });
});

describe("AgentSkillRepository.findTopKByRelevance", () => {
  it("scores and sorts active skills, capping at k and MAX_SKILLS_INJECTED (default 3)", async () => {
    const skills = [
      makeSkill({ id: "s1", taskCategory: "deployment", skillMarkdown: "deploy to prod" }),
      makeSkill({ id: "s2", taskCategory: "testing", skillMarkdown: "unrelated content" }),
      makeSkill({ id: "s3", taskCategory: "deployment", skillMarkdown: "deploy rollback" }),
      makeSkill({ id: "s4", taskCategory: "deployment", skillMarkdown: "deploy canary" }),
    ];
    const findMany = vi.fn().mockResolvedValue(skills);
    const repo = new AgentSkillRepository(makePrisma({ findMany }));

    const results = await repo.findTopKByRelevance("test-repo", "deploy", 10);

    // MAX_SKILLS_INJECTED defaults to 3, so even though k=10 and 4 skills exist,
    // at most 3 come back.
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results.every((r) => typeof r.id === "string")).toBe(true);
  });

  it("returns an empty array when there are no active skills", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repo = new AgentSkillRepository(makePrisma({ findMany }));

    const results = await repo.findTopKByRelevance("test-repo", "deploy", 5);

    expect(results).toEqual([]);
  });

  it("respects a k smaller than MAX_SKILLS_INJECTED", async () => {
    const skills = [
      makeSkill({ id: "s1" }),
      makeSkill({ id: "s2" }),
      makeSkill({ id: "s3" }),
    ];
    const findMany = vi.fn().mockResolvedValue(skills);
    const repo = new AgentSkillRepository(makePrisma({ findMany }));

    const results = await repo.findTopKByRelevance("test-repo", "deploy", 1);

    expect(results).toHaveLength(1);
  });
});

describe("AgentSkillRepository.incrementSuccess", () => {
  it("increments successCount and recomputes utilityScore inside a transaction", async () => {
    const skill = makeSkill({ successCount: 2, failureCount: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue(skill);
    const update = vi.fn().mockResolvedValue({ ...skill, successCount: 3 });
    const tx = { agentSkill: { findUniqueOrThrow, update } };
    const $transaction = vi.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    const prisma = { agentSkill: {}, $transaction } as unknown as PrismaClient;
    const repo = new AgentSkillRepository(prisma);

    await repo.incrementSuccess("skill-1");

    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    // newSuccessCount = 3, utilityScore = 3 / (3 + 1 + 1) = 0.6
    expect(update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        successCount: 3,
        utilityScore: 0.6,
        lastUsedAt: expect.any(Date),
      },
    });
  });
});

describe("AgentSkillRepository.incrementFailure", () => {
  it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
    const skill = makeSkill({ successCount: 2, failureCount: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue(skill);
    const update = vi.fn().mockResolvedValue({ ...skill, failureCount: 2 });
    const tx = { agentSkill: { findUniqueOrThrow, update } };
    const $transaction = vi.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    const prisma = { agentSkill: {}, $transaction } as unknown as PrismaClient;
    const repo = new AgentSkillRepository(prisma);

    await repo.incrementFailure("skill-1");

    // newFailureCount = 2, utilityScore = 2 / (2 + 2 + 1) = 0.4
    expect(update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        failureCount: 2,
        utilityScore: 0.4,
        lastUsedAt: expect.any(Date),
      },
    });
  });
});

describe("AgentSkillRepository.archiveIfLowUtility", () => {
  it("archives when utilityScore is below 0.2 and total uses is at least 5", async () => {
    const update = vi.fn().mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(makePrisma({ update }));
    const skill = makeSkill({ id: "skill-2", utilityScore: 0.1, successCount: 1, failureCount: 4 });

    await repo.archiveIfLowUtility(skill as never);

    expect(update).toHaveBeenCalledWith({
      where: { id: "skill-2" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("does not archive when utilityScore is below threshold but total uses is under 5", async () => {
    const update = vi.fn();
    const repo = new AgentSkillRepository(makePrisma({ update }));
    const skill = makeSkill({ id: "skill-3", utilityScore: 0.1, successCount: 1, failureCount: 2 });

    await repo.archiveIfLowUtility(skill as never);

    expect(update).not.toHaveBeenCalled();
  });

  it("does not archive when utilityScore is at or above threshold", async () => {
    const update = vi.fn();
    const repo = new AgentSkillRepository(makePrisma({ update }));
    const skill = makeSkill({ id: "skill-4", utilityScore: 0.2, successCount: 3, failureCount: 3 });

    await repo.archiveIfLowUtility(skill as never);

    expect(update).not.toHaveBeenCalled();
  });
});

describe("AgentSkillRepository.displaceAndCreate", () => {
  it("archives the lowest-utility active skill and creates a new one in a transaction", async () => {
    const lowest = makeSkill({ id: "skill-low", utilityScore: 0.05 });
    const findFirst = vi.fn().mockResolvedValue(lowest);
    const update = vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() });
    const created = makeSkill({ id: "skill-new" });
    const create = vi.fn().mockResolvedValue(created);
    const tx = { agentSkill: { findFirst, update, create } };
    const $transaction = vi.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    const prisma = { agentSkill: {}, $transaction } as unknown as PrismaClient;
    const repo = new AgentSkillRepository(prisma);

    const result = await repo.displaceAndCreate("test-repo", {
      name: "New skill",
      description: "desc",
      taskCategory: "deployment",
      skillMarkdown: "# New",
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "skill-low" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ repoSlug: "test-repo", name: "New skill", utilityScore: 0.0 }),
    });
    expect(result.newSkill.id).toBe("skill-new");
    expect(result.displacedSkillId).toBe("skill-low");
  });

  it("throws when there are no active skills to displace", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const tx = { agentSkill: { findFirst } };
    const $transaction = vi.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    const prisma = { agentSkill: {}, $transaction } as unknown as PrismaClient;
    const repo = new AgentSkillRepository(prisma);

    await expect(
      repo.displaceAndCreate("test-repo", {
        name: "New skill",
        description: "desc",
        taskCategory: "deployment",
        skillMarkdown: "# New",
      }),
    ).rejects.toThrow("No active skills found for repo test-repo to displace");
  });
});
