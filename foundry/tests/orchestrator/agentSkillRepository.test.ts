import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "retry-flaky-tests",
    description: "Retries flaky integration tests",
    taskCategory: "testing",
    skillMarkdown: "When a test is flaky, retry it up to 3 times before failing the build.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    createdAt: new Date("2024-01-01T00:00:00Z"),
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
      findUniqueOrThrow: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

describe("mapAgentSkillToDocument", () => {
  it("projects an AgentSkill row down to the SkillDocument fields used for retrieval", () => {
    const skill = makeSkill();
    expect(mapAgentSkillToDocument(skill)).toEqual({
      id: "skill-1",
      repoSlug: "org/repo",
      name: "retry-flaky-tests",
      description: "Retries flaky integration tests",
      taskCategory: "testing",
      skillMarkdown: skill.skillMarkdown,
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("seeds utilityScore/successCount/failureCount to zero for a brand new skill", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.create.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      await repo.create({
        repoSlug: "org/repo",
        name: "retry-flaky-tests",
        description: "Retries flaky integration tests",
        taskCategory: "testing",
        skillMarkdown: "md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "retry-flaky-tests",
          description: "Retries flaky integration tests",
          taskCategory: "testing",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findUnique.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when not found", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      expect(await repo.findById("missing")).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default +/-5000ms window around the given time", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2024-01-01T00:00:10Z");

      await repo.findByRepoCategoryNearTime("org/repo", "testing", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "testing",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("honors a custom windowMs override", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2024-01-01T00:00:10Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "testing", around, 500);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date(around.getTime() - 500),
              lte: new Date(around.getTime() + 500),
            },
          }),
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("filters to non-archived skills for the given repo", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the given repo", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.count.mockResolvedValue(7);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc to find the weakest active skill", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill({ utilityScore: 0.05 }));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.utilityScore).toBe(0.05);
    });

    it("returns null when there are no active skills", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      expect(await repo.findLowestUtilityActive("org/repo")).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query and returns the top k as SkillDocuments", async () => {
      const prisma = makePrisma();
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "flaky test retries",
        skillMarkdown: "Retry flaky integration tests up to three times.",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "deployment",
        skillMarkdown: "Roll out canary deployments gradually across regions.",
      });
      prisma.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("org/repo", "flaky test retries", 2);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result[0].id).toBe("relevant");
      expect(result.every((doc) => "skillMarkdown" in doc)).toBe(true);
    });

    it("caps the returned count at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const prisma = makePrisma();
      const skills = Array.from({ length: 5 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: `category-${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("org/repo", "category-0", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when the repo has no active skills", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      expect(await repo.findTopKByRelevance("org/repo", "anything", 3)).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const prisma = makePrisma();
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(
            makeSkill({ successCount: 2, failureCount: 1 }),
          ),
          update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...makeSkill(), ...data })),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementSuccess("skill-1");

      // successCount 2 -> 3; utilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          successCount: 3,
          utilityScore: 0.6,
          lastUsedAt: expect.any(Date),
        }),
      });
      expect(result.successCount).toBe(3);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const prisma = makePrisma();
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(
            makeSkill({ successCount: 2, failureCount: 1 }),
          ),
          update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...makeSkill(), ...data })),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementFailure("skill-1");

      // failureCount 1 -> 2; utilityScore = 2 / (2 + 2 + 1) = 0.4
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          failureCount: 2,
          utilityScore: 0.4,
          lastUsedAt: expect.any(Date),
        }),
      });
      expect(result.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility", () => {
    let repo: AgentSkillRepository;
    let archiveSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      const prisma = makePrisma();
      repo = new AgentSkillRepository(prisma as never);
      archiveSpy = vi.spyOn(repo, "archiveById").mockResolvedValue(undefined);
    });

    it("archives a skill with low utility and at least 5 total uses", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(archiveSpy).toHaveBeenCalledWith("skill-1");
    });

    it("does not archive when utilityScore is at or above the 0.2 threshold", async () => {
      const skill = makeSkill({ utilityScore: 0.2, successCount: 3, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(archiveSpy).not.toHaveBeenCalled();
    });

    it("does not archive when total uses are below 5, even with low utility", async () => {
      const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(archiveSpy).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one in its place", async () => {
      const prisma = makePrisma();
      const lowest = makeSkill({ id: "low-1", utilityScore: 0.01 });
      const created = makeSkill({ id: "new-1" });
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(lowest),
          update: vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() }),
          create: vi.fn().mockResolvedValue(created),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "md",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-1" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          repoSlug: "org/repo",
          name: "new-skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        }),
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "low-1" });
    });

    it("throws when there are no active skills to displace", async () => {
      const prisma = makePrisma();
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");
      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
