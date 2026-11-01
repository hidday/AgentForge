import { describe, it, expect, vi, beforeEach } from "vitest";
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
    description: "Stabilizes flaky tests",
    taskCategory: "testing",
    skillMarkdown: "# Fix flaky tests\nRetry with backoff.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    archivedAt: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(overrides as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makePrisma() {
  const tx = {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
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
    $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    __tx: tx,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("mapAgentSkillToDocument", () => {
  it("projects an AgentSkill row down to a SkillDocument", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: "skill-1",
      repoSlug: "org/repo",
      name: "fix-flaky-tests",
      description: "Stabilizes flaky tests",
      taskCategory: "testing",
      skillMarkdown: skill.skillMarkdown,
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma);
  });

  it("create() seeds utility/usage counters to zero", async () => {
    prisma.agentSkill.create.mockResolvedValue(makeSkill());
    await repo.create({
      repoSlug: "org/repo",
      name: "fix-flaky-tests",
      description: "desc",
      taskCategory: "testing",
      skillMarkdown: "md",
    });
    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      }),
    });
  });

  it("findById() returns null when the skill does not exist", async () => {
    prisma.agentSkill.findUnique.mockResolvedValue(null);
    expect(await repo.findById("missing")).toBeNull();
  });

  it("findByRepoCategoryNearTime() queries within the surrounding time window", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    const around = new Date("2026-01-01T00:00:10.000Z");
    await repo.findByRepoCategoryNearTime("org/repo", "testing", around, 5000);
    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
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
  });

  it("findByRepoCategoryNearTime() defaults the window to 5000ms", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const around = new Date("2026-01-01T00:00:10.000Z");
    await repo.findByRepoCategoryNearTime("org/repo", "testing", around);
    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        }),
      }),
    );
  });

  it("findActiveByRepo() filters to non-archived skills for the repo", async () => {
    prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
    const skills = await repo.findActiveByRepo("org/repo");
    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
    expect(skills).toHaveLength(1);
  });

  it("countActiveByRepo() returns the active count", async () => {
    prisma.agentSkill.count.mockResolvedValue(4);
    expect(await repo.countActiveByRepo("org/repo")).toBe(4);
    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
  });

  it("findLowestUtilityActive() orders by utility then last-used ascending", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill({ utilityScore: 0.1 }));
    const skill = await repo.findLowestUtilityActive("org/repo");
    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
    expect(skill?.utilityScore).toBe(0.1);
  });

  it("findLowestUtilityActive() returns null when there are no active skills", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    expect(await repo.findLowestUtilityActive("org/repo")).toBeNull();
  });

  it("archiveById() stamps archivedAt with the current time", async () => {
    prisma.agentSkill.update.mockResolvedValue(makeSkill());
    await repo.archiveById("skill-1");
    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query and caps at k", async () => {
      const skills = [
        makeSkill({ id: "s1", taskCategory: "testing", skillMarkdown: "flaky test retries" }),
        makeSkill({ id: "s2", taskCategory: "deployment", skillMarkdown: "blue-green rollout" }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const docs = await repo.findTopKByRelevance("org/repo", "flaky test retries", 5);
      expect(docs[0].id).toBe("s1");
    });

    it("caps the returned count at env.MAX_SKILLS_INJECTED even if k is larger", async () => {
      const skills = Array.from({ length: 5 }, (_, i) =>
        makeSkill({ id: `s${i}`, taskCategory: `cat-${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const docs = await repo.findTopKByRelevance("org/repo", "cat-0", 100);
      expect(docs.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when the repo has no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const docs = await repo.findTopKByRelevance("org/repo", "anything", 5);
      expect(docs).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments the success count and recomputes utility inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.__tx.agentSkill.update.mockResolvedValue(
        makeSkill({ successCount: 3, utilityScore: 3 / 5 }),
      );

      const updated = await repo.incrementSuccess("skill-1");

      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(updated.successCount).toBe(3);
    });
  });

  describe("incrementFailure", () => {
    it("increments the failure count and recomputes utility inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.__tx.agentSkill.update.mockResolvedValue(
        makeSkill({ failureCount: 2, utilityScore: 2 / 5 }),
      );

      const updated = await repo.incrementFailure("skill-1");

      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(updated.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives a skill with low utility and enough uses", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is low but usage count is below the threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 1 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility is at or above the threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.5, successCount: 3, failureCount: 3 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one in a transaction", async () => {
      const lowest = makeSkill({ id: "low-1", utilityScore: 0.05 });
      const created = makeSkill({ id: "new-1", name: "new-skill" });
      prisma.__tx.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.__tx.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      prisma.__tx.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "md",
      });

      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-1" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.__tx.agentSkill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ repoSlug: "org/repo", name: "new-skill" }),
      });
      expect(result.newSkill.id).toBe("new-1");
      expect(result.displacedSkillId).toBe("low-1");
    });

    it("throws when there are no active skills to displace", async () => {
      prisma.__tx.agentSkill.findFirst.mockResolvedValue(null);
      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");
      expect(prisma.__tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
