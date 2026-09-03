import { describe, it, expect, vi } from "vitest";
import { AgentSkillRepository, mapAgentSkillToDocument } from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "handle-auth",
    description: "Handles auth flows",
    taskCategory: "auth",
    skillMarkdown: "# Auth skill\nDo the auth thing.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
}

function buildPrisma() {
  const agentSkill = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  const prisma: { agentSkill: typeof agentSkill; $transaction: ReturnType<typeof vi.fn> } = {
    agentSkill,
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
  return prisma;
}

describe("mapAgentSkillToDocument", () => {
  it("maps a skill row to a SkillDocument, dropping non-document fields", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: "skill-1",
      repoSlug: "test-repo",
      name: "handle-auth",
      description: "Handles auth flows",
      taskCategory: "auth",
      skillMarkdown: "# Auth skill\nDo the auth thing.",
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.create.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.create({
        repoSlug: "test-repo",
        name: "handle-auth",
        description: "Handles auth flows",
        taskCategory: "auth",
        skillMarkdown: "# Auth skill",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "test-repo",
          name: "handle-auth",
          description: "Handles auth flows",
          taskCategory: "auth",
          skillMarkdown: "# Auth skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result.id).toBe("skill-1");
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findUnique.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when not found", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window around the given time", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-01-01T00:00:10Z");

      const result = await repo.findByRepoCategoryNearTime("test-repo", "auth", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
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
      expect(result?.id).toBe("skill-1");
    });

    it("honors a custom window size", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2026-01-01T00:00:10Z");

      const result = await repo.findByRepoCategoryNearTime("test-repo", "auth", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
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

  describe("findActiveByRepo", () => {
    it("queries non-archived skills for the repo", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findActiveByRepo("test-repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      const prisma = buildPrisma();
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
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const prisma = buildPrisma();
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
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("test-repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      const prisma = buildPrisma();
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
    it("returns skills scored and sorted by relevance descending", async () => {
      const prisma = buildPrisma();
      const authSkill = makeSkill({
        id: "skill-auth",
        taskCategory: "authentication",
        skillMarkdown: "authentication authentication authentication login flow",
      });
      const unrelatedSkill = makeSkill({
        id: "skill-unrelated",
        taskCategory: "zzz totally different topic",
        skillMarkdown: "zzz totally unrelated content about nothing at all",
      });
      prisma.agentSkill.findMany.mockResolvedValue([unrelatedSkill, authSkill]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("test-repo", "authentication login flow", 5);

      expect(result.map((d) => d.id)).toEqual(["skill-auth", "skill-unrelated"]);
    });

    it("caps the returned count at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const prisma = buildPrisma();
      const skills = Array.from({ length: 5 }, (_, i) => makeSkill({ id: `skill-${i}` }));
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("test-repo", "some query", 10);

      // env.MAX_SKILLS_INJECTED defaults to 3 when unset.
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("test-repo", "query", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const prisma = buildPrisma();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
      prisma.agentSkill.update.mockResolvedValue(updated);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.successCount).toBe(3);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const prisma = buildPrisma();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ successCount: 2, failureCount: 2, utilityScore: 2 / 5 });
      prisma.agentSkill.update.mockResolvedValue(updated);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result.failureCount).toBe(2);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore < 0.2 and total uses >= 5", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveIfLowUtility(
        makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 }),
      );

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is low but total uses < 5", async () => {
      const prisma = buildPrisma();
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveIfLowUtility(
        makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 1 }),
      );

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses >= 5 but utilityScore is not low", async () => {
      const prisma = buildPrisma();
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveIfLowUtility(
        makeSkill({ utilityScore: 0.5, successCount: 3, failureCount: 2 }),
      );

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive at exactly the utilityScore boundary (0.2 is not < 0.2)", async () => {
      const prisma = buildPrisma();
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveIfLowUtility(
        makeSkill({ utilityScore: 0.2, successCount: 3, failureCount: 2 }),
      );

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a new one, inside a transaction", async () => {
      const prisma = buildPrisma();
      const lowest = makeSkill({ id: "skill-lowest", utilityScore: 0.05 });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      const newSkillRow = makeSkill({ id: "skill-new", name: "new-skill" });
      prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      prisma.agentSkill.create.mockResolvedValue(newSkillRow);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("test-repo", {
        name: "new-skill",
        description: "A new skill",
        taskCategory: "auth",
        skillMarkdown: "# New skill",
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "test-repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "test-repo",
          name: "new-skill",
          description: "A new skill",
          taskCategory: "auth",
          skillMarkdown: "# New skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result.newSkill.id).toBe("skill-new");
      expect(result.displacedSkillId).toBe("skill-lowest");
    });

    it("throws when there are no active skills to displace for the repo", async () => {
      const prisma = buildPrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("test-repo", {
          name: "new-skill",
          description: "A new skill",
          taskCategory: "auth",
          skillMarkdown: "# New skill",
        }),
      ).rejects.toThrow("No active skills found for repo test-repo to displace");

      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
