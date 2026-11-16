import { describe, it, expect, vi, beforeEach } from "vitest";
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
    name: "retry-logic",
    description: "Handles retries",
    taskCategory: "backend",
    skillMarkdown: "# Retry logic\nUse exponential backoff.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
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
    $transaction: vi.fn(),
  } as unknown as PrismaClient;
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill to a SkillDocument with the expected shape", () => {
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
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma);
  });

  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      const created = makeSkill();
      (prisma.agentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);

      const result = await repo.create({
        repoSlug: "acme/repo",
        name: "retry-logic",
        description: "Handles retries",
        taskCategory: "backend",
        skillMarkdown: "# Retry logic",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/repo",
          name: "retry-logic",
          description: "Handles retries",
          taskCategory: "backend",
          skillMarkdown: "# Retry logic",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toBe(created);
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const skill = makeSkill({ id: "skill-42" });
      (prisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(skill);

      const result = await repo.findById("skill-42");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-42" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      (prisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries with a time window around the given timestamp using the default window", async () => {
      const around = new Date("2024-06-01T12:00:00Z");
      const skill = makeSkill();
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(skill);

      const result = await repo.findByRepoCategoryNearTime("acme/repo", "backend", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("honors a custom windowMs", async () => {
      const around = new Date("2024-06-01T12:00:00Z");
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findByRepoCategoryNearTime("acme/repo", "backend", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/repo",
          taskCategory: "backend",
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
      const skills = [makeSkill()];
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);

      const result = await repo.findActiveByRepo("acme/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the count of active skills for the repo", async () => {
      (prisma.agentSkill.count as ReturnType<typeof vi.fn>).mockResolvedValue(7);

      const result = await repo.countActiveByRepo("acme/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("queries ordered by utilityScore asc then lastUsedAt asc", async () => {
      const skill = makeSkill();
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(skill);

      const result = await repo.findLowestUtilityActive("acme/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when there are no active skills", async () => {
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findLowestUtilityActive("acme/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date on the given skill", async () => {
      (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const callArg = (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArg.where).toEqual({ id: "skill-1" });
      expect(callArg.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance and returns the top k as SkillDocuments", async () => {
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "database migrations",
        skillMarkdown: "database migrations require careful planning for database migrations",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "unrelated topic",
        skillMarkdown: "nothing to do with the query at all",
      });
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        irrelevant,
        relevant,
      ]);

      const result = await repo.findTopKByRelevance("acme/repo", "database migrations", 1);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("relevant");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `skill-${i}`, taskCategory: `category-${i}` }),
      );
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("acme/repo", "category-3", 100);

      // env.MAX_SKILLS_INJECTED defaults to 3
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findTopKByRelevance("acme/repo", "anything", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 1, failureCount: 1 });
      const updated = makeSkill({ successCount: 2, failureCount: 1, utilityScore: 2 / 4 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue(updated),
        },
      };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: (tx: unknown) => unknown) => cb(tx),
      );

      const result = await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 2,
          utilityScore: 2 / 4,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 1, failureCount: 1 });
      const updated = makeSkill({ successCount: 1, failureCount: 2, utilityScore: 1 / 4 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue(updated),
        },
      };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: (tx: unknown) => unknown) => cb(tx),
      );

      const result = await repo.incrementFailure("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 1 / 4,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore < 0.2 and total uses >= 5", async () => {
      (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "low-util", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-util" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is high even with many uses", async () => {
      const skill = makeSkill({ utilityScore: 0.9, successCount: 9, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utilityScore is low but total uses < 5", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a new one in a transaction", async () => {
      const lowest = makeSkill({ id: "lowest" });
      const created = makeSkill({ id: "new-skill" });
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(lowest),
          update: vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() }),
          create: vi.fn().mockResolvedValue(created),
        },
      };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: (tx: unknown) => unknown) => cb(tx),
      );

      const result = await repo.displaceAndCreate("acme/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "backend",
        skillMarkdown: "# New",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "backend",
          skillMarkdown: "# New",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: (tx: unknown) => unknown) => cb(tx),
      );

      await expect(
        repo.displaceAndCreate("acme/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "backend",
          skillMarkdown: "# New",
        }),
      ).rejects.toThrow("No active skills found for repo acme/repo to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
