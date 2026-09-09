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
    name: "Skill One",
    description: "Does a thing",
    taskCategory: "backend",
    skillMarkdown: "# Skill One\nDo the thing.",
    utilityScore: 0.5,
    successCount: 1,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as unknown as AgentSkill;
}

function buildPrismaMock() {
  const agentSkill = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  // $transaction here just invokes the callback with a tx object that proxies
  // to the same mocked methods, matching how a real Prisma interactive
  // transaction would be exercised against an in-memory fake.
  const prisma = {
    agentSkill,
    $transaction: vi.fn((cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
  };
  return prisma;
}

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.create.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      await repo.create({
        repoSlug: "test-repo",
        name: "Skill One",
        description: "Does a thing",
        taskCategory: "backend",
        skillMarkdown: "# Skill One",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          repoSlug: "test-repo",
          name: "Skill One",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        }),
      });
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.findUnique.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when not found", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window around the given time", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-01-01T12:00:00Z");

      await repo.findByRepoCategoryNearTime("test-repo", "backend", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "test-repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date("2026-01-01T11:59:55Z"),
            lte: new Date("2026-01-01T12:00:05Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("honors a custom windowMs", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-01-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("test-repo", "backend", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date("2026-01-01T11:59:59Z"),
            lte: new Date("2026-01-01T12:00:01Z"),
          },
        }),
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo / countActiveByRepo", () => {
    it("filters by repoSlug and archivedAt: null", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findActiveByRepo("test-repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });

    it("counts active skills for a repo", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.count.mockResolvedValue(4);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.countActiveByRepo("test-repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill({ utilityScore: 0.1 }));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("test-repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result?.utilityScore).toBe(0.1);
    });

    it("returns null when there are no active skills", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("test-repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills, sorts by relevance descending, and truncates to k", async () => {
      const prisma = buildPrismaMock();
      const skills = [
        makeSkill({
          id: "skill-low",
          name: "Unrelated",
          description: "Something else entirely",
          taskCategory: "frontend",
          skillMarkdown: "irrelevant content",
        }),
        makeSkill({
          id: "skill-high",
          name: "Database Migration",
          description: "How to write a database migration",
          taskCategory: "backend",
          skillMarkdown: "database migration steps for postgres",
        }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("test-repo", "database migration backend", 5);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].id).toBe("skill-high");
    });

    it("caps the requested k at env.MAX_SKILLS_INJECTED", async () => {
      const prisma = buildPrismaMock();
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({
          id: `skill-${i}`,
          name: `Skill ${i}`,
          description: "backend task helper",
          taskCategory: "backend",
          skillMarkdown: "backend task helper content",
        }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      // Request far more than the configured MAX_SKILLS_INJECTED (default 3).
      const result = await repo.findTopKByRelevance("test-repo", "backend task", 999);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("test-repo", "anything", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const prisma = buildPrismaMock();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...existing, ...args.data }),
      );
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / (3 + 1 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const prisma = buildPrismaMock();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...existing, ...args.data }),
      );
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / (2 + 2 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore is below 0.2 and total uses >= 5", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as never);
      const lowUtilitySkill = makeSkill({
        id: "skill-low",
        utilityScore: 0.1,
        successCount: 1,
        failureCount: 4,
      });

      await repo.archiveIfLowUtility(lowUtilitySkill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is below 0.2 but total uses < 5", async () => {
      const prisma = buildPrismaMock();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utilityScore is at or above 0.2 regardless of usage", async () => {
      const prisma = buildPrismaMock();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ utilityScore: 0.2, successCount: 5, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one in a transaction", async () => {
      const prisma = buildPrismaMock();
      const lowest = makeSkill({ id: "skill-lowest", utilityScore: 0.05 });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      const created = makeSkill({ id: "skill-new", name: "New Skill" });
      prisma.agentSkill.create.mockResolvedValue(created);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("test-repo", {
        name: "New Skill",
        description: "desc",
        taskCategory: "backend",
        skillMarkdown: "# New Skill",
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(result.displacedSkillId).toBe("skill-lowest");
      expect(result.newSkill.id).toBe("skill-new");
    });

    it("throws when there is no active skill to displace", async () => {
      const prisma = buildPrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("empty-repo", {
          name: "New Skill",
          description: "desc",
          taskCategory: "backend",
          skillMarkdown: "# New Skill",
        }),
      ).rejects.toThrow(/No active skills found for repo empty-repo/);

      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to its SkillDocument shape", () => {
    const skill = makeSkill({
      id: "skill-7",
      repoSlug: "repo-a",
      name: "Skill Seven",
      description: "desc",
      taskCategory: "infra",
      skillMarkdown: "# md",
      utilityScore: 0.75,
      lastUsedAt: new Date("2026-02-01T00:00:00Z"),
    });

    const doc = mapAgentSkillToDocument(skill);

    expect(doc).toEqual({
      id: "skill-7",
      repoSlug: "repo-a",
      name: "Skill Seven",
      description: "desc",
      taskCategory: "infra",
      skillMarkdown: "# md",
      utilityScore: 0.75,
      lastUsedAt: new Date("2026-02-01T00:00:00Z"),
    });
  });
});
