import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "acme/backend",
    name: "api-validation",
    description: "Validate API requests",
    taskCategory: "api validation middleware",
    skillMarkdown: "# API validation\nUse Zod schemas to validate incoming requests.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function makePrisma() {
  return {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(undefined)),
  };
}

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma as never);
  });

  it("creates a skill with zeroed counters and utility score", async () => {
    prisma.agentSkill.create.mockResolvedValue(makeSkill());
    await repo.create({
      repoSlug: "acme/backend",
      name: "api-validation",
      description: "Validate API requests",
      taskCategory: "api validation middleware",
      skillMarkdown: "# API validation",
    });
    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      }),
    });
  });

  it("findById returns null when the skill does not exist", async () => {
    prisma.agentSkill.findUnique.mockResolvedValue(null);
    expect(await repo.findById("missing")).toBeNull();
  });

  it("findByRepoCategoryNearTime queries a window around the given time", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    const around = new Date("2026-01-01T00:00:10Z");
    await repo.findByRepoCategoryNearTime("acme/backend", "api", around, 2000);
    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "acme/backend",
        taskCategory: "api",
        createdAt: {
          gte: new Date("2026-01-01T00:00:08Z"),
          lte: new Date("2026-01-01T00:00:12Z"),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findByRepoCategoryNearTime defaults the window to 5000ms", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const around = new Date("2026-01-01T00:00:10Z");
    await repo.findByRepoCategoryNearTime("acme/backend", "api", around);
    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date("2026-01-01T00:00:05Z"),
            lte: new Date("2026-01-01T00:00:15Z"),
          },
        }),
      }),
    );
  });

  it("findActiveByRepo filters out archived skills", async () => {
    prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
    await repo.findActiveByRepo("acme/backend");
    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "acme/backend", archivedAt: null },
    });
  });

  it("countActiveByRepo counts only active skills", async () => {
    prisma.agentSkill.count.mockResolvedValue(4);
    const count = await repo.countActiveByRepo("acme/backend");
    expect(count).toBe(4);
    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "acme/backend", archivedAt: null },
    });
  });

  it("findLowestUtilityActive orders by utility then lastUsedAt ascending", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    await repo.findLowestUtilityActive("acme/backend");
    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "acme/backend", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
  });

  it("archiveById sets archivedAt to the current time", async () => {
    prisma.agentSkill.update.mockResolvedValue(makeSkill());
    await repo.archiveById("skill-1");
    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks skills by relevance to the query and returns mapped documents", async () => {
      const relevant = makeSkill({
        id: "skill-relevant",
        taskCategory: "api request validation",
        skillMarkdown: "Validate API request bodies with Zod schemas before handling.",
      });
      const irrelevant = makeSkill({
        id: "skill-irrelevant",
        taskCategory: "database migrations",
        skillMarkdown: "Write reversible Prisma migrations for schema changes.",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);

      const results = await repo.findTopKByRelevance(
        "acme/backend",
        "api request validation",
        5,
      );

      expect(results[0].id).toBe("skill-relevant");
      expect(results.map((r) => r.id)).toContain("skill-irrelevant");
    });

    it("clamps k to the configured MAX_SKILLS_INJECTED ceiling", async () => {
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: `category ${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const results = await repo.findTopKByRelevance("acme/backend", "category 1", 10);

      // env.MAX_SKILLS_INJECTED defaults to 3
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const results = await repo.findTopKByRelevance("acme/backend", "anything", 5);
      expect(results).toEqual([]);
    });
  });

  describe("incrementSuccess / incrementFailure", () => {
    it("increments successCount and recomputes utilityScore", async () => {
      const current = makeSkill({ successCount: 2, failureCount: 1 });
      const txAgentSkill = {
        findUniqueOrThrow: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue(makeSkill({ successCount: 3, failureCount: 1 })),
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({ agentSkill: txAgentSkill }),
      );

      await repo.incrementSuccess("skill-1");

      expect(txAgentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          successCount: 3,
          utilityScore: 3 / (3 + 1 + 1),
          lastUsedAt: expect.any(Date),
        }),
      });
    });

    it("increments failureCount and recomputes utilityScore", async () => {
      const current = makeSkill({ successCount: 2, failureCount: 1 });
      const txAgentSkill = {
        findUniqueOrThrow: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue(makeSkill({ successCount: 2, failureCount: 2 })),
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({ agentSkill: txAgentSkill }),
      );

      await repo.incrementFailure("skill-1");

      expect(txAgentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          failureCount: 2,
          utilityScore: 2 / (2 + 2 + 1),
          lastUsedAt: expect.any(Date),
        }),
      });
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
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility is at or above the threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.2, successCount: 3, failureCount: 3 });
      await repo.archiveIfLowUtility(skill);
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("throws when there are no active skills to displace", async () => {
      const txAgentSkill = {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn(),
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({ agentSkill: txAgentSkill }),
      );

      await expect(
        repo.displaceAndCreate("acme/backend", {
          name: "new-skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow('No active skills found for repo acme/backend to displace');
    });

    it("archives the lowest-utility skill and creates the new one", async () => {
      const lowest = makeSkill({ id: "skill-lowest", utilityScore: 0.05 });
      const created = makeSkill({ id: "skill-new" });
      const txAgentSkill = {
        findFirst: vi.fn().mockResolvedValue(lowest),
        update: vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() }),
        create: vi.fn().mockResolvedValue(created),
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({ agentSkill: txAgentSkill }),
      );

      const result = await repo.displaceAndCreate("acme/backend", {
        name: "new-skill",
        description: "desc",
        taskCategory: "cat",
        skillMarkdown: "md",
      });

      expect(txAgentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(txAgentSkill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ repoSlug: "acme/backend", name: "new-skill" }),
      });
      expect(result.displacedSkillId).toBe("skill-lowest");
      expect(result.newSkill.id).toBe("skill-new");
    });
  });
});

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument", () => {
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
