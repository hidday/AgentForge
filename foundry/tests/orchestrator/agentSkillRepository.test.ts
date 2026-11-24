import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "repo-a",
    name: "deploy-via-pm2",
    description: "How to deploy with pm2",
    taskCategory: "deployment",
    skillMarkdown: "# Deploy via pm2\nRun pm2 start.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as AgentSkill;
}

function makePrisma() {
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
  return prisma;
}

describe("mapAgentSkillToDocument", () => {
  it("maps a skill row to a SkillDocument", () => {
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
      const prisma = makePrisma();
      prisma.agentSkill.create.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      await repo.create({
        repoSlug: "repo-a",
        name: "n",
        description: "d",
        taskCategory: "t",
        skillMarkdown: "m",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ utilityScore: 0, successCount: 0, failureCount: 0 }),
      });
    });
  });

  it("findById delegates to findUnique by id", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findUnique.mockResolvedValue(null);
    const repo = new AgentSkillRepository(prisma as never);

    const result = await repo.findById("skill-1");

    expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
    expect(result).toBeNull();
  });

  it("findByRepoCategoryNearTime queries a time window around the given date", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma as never);
    const around = new Date("2026-02-01T00:00:00Z");

    await repo.findByRepoCategoryNearTime("repo-a", "deployment", around, 1000);

    const call = prisma.agentSkill.findFirst.mock.calls[0]![0] as {
      where: { createdAt: { gte: Date; lte: Date } };
    };
    expect(call.where.createdAt.gte.getTime()).toBe(around.getTime() - 1000);
    expect(call.where.createdAt.lte.getTime()).toBe(around.getTime() + 1000);
  });

  it("findActiveByRepo filters out archived skills", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
    const repo = new AgentSkillRepository(prisma as never);

    await repo.findActiveByRepo("repo-a");

    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "repo-a", archivedAt: null },
    });
  });

  it("countActiveByRepo counts non-archived skills", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.count.mockResolvedValue(4);
    const repo = new AgentSkillRepository(prisma as never);

    const count = await repo.countActiveByRepo("repo-a");

    expect(count).toBe(4);
    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "repo-a", archivedAt: null },
    });
  });

  it("findLowestUtilityActive orders by utilityScore then lastUsedAt ascending", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma as never);

    await repo.findLowestUtilityActive("repo-a");

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "repo-a", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
  });

  it("archiveById sets archivedAt to a Date", async () => {
    const prisma = makePrisma();
    prisma.agentSkill.update.mockResolvedValue(makeSkill());
    const repo = new AgentSkillRepository(prisma as never);

    await repo.archiveById("skill-1");

    const call = prisma.agentSkill.update.mock.calls[0]![0] as {
      where: { id: string };
      data: { archivedAt: Date };
    };
    expect(call.where).toEqual({ id: "skill-1" });
    expect(call.data.archivedAt).toBeInstanceOf(Date);
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query and caps at MAX_SKILLS_INJECTED", async () => {
      const prisma = makePrisma();
      const skills = [
        makeSkill({ id: "s1", taskCategory: "deployment pm2 restart", skillMarkdown: "pm2 deploy guide" }),
        makeSkill({ id: "s2", taskCategory: "unrelated topic entirely", skillMarkdown: "zzz" }),
        makeSkill({ id: "s3", taskCategory: "deployment", skillMarkdown: "deploy with pm2 restart" }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("repo-a", "pm2 deploy restart", 10);

      // capped at env.MAX_SKILLS_INJECTED (default 3), and the unrelated skill should rank last
      expect(result.length).toBeLessThanOrEqual(3);
      expect(result.map((d) => d.id)).not.toEqual(["s2"]);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("repo-a", "anything", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess / incrementFailure", () => {
    it("incrementSuccess bumps successCount and recomputes utilityScore", async () => {
      const prisma = makePrisma();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existing, ...data }),
      );
      const repo = new AgentSkillRepository(prisma as never);

      const updated = await repo.incrementSuccess("skill-1");

      expect(updated.successCount).toBe(3);
      expect(updated.utilityScore).toBeCloseTo(3 / 5);
    });

    it("incrementFailure bumps failureCount and recomputes utilityScore", async () => {
      const prisma = makePrisma();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existing, ...data }),
      );
      const repo = new AgentSkillRepository(prisma as never);

      const updated = await repo.incrementFailure("skill-1");

      expect(updated.failureCount).toBe(2);
      expect(updated.utilityScore).toBeCloseTo(2 / 5);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives a skill with low utility and enough uses", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is low but total uses is under the threshold", async () => {
      const prisma = makePrisma();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility is high even with many uses", async () => {
      const prisma = makePrisma();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.9, successCount: 10, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility skill and creates a new one in the same transaction", async () => {
      const prisma = makePrisma();
      const lowest = makeSkill({ id: "low-1", utilityScore: 0.01 });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      const created = makeSkill({ id: "new-1" });
      prisma.agentSkill.create.mockResolvedValue(created);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("repo-a", {
        name: "n",
        description: "d",
        taskCategory: "t",
        skillMarkdown: "m",
      });

      expect(result.displacedSkillId).toBe("low-1");
      expect(result.newSkill.id).toBe("new-1");
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("throws when there are no active skills to displace", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("repo-a", {
          name: "n",
          description: "d",
          taskCategory: "t",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow(/No active skills found for repo repo-a/);
    });
  });
});
