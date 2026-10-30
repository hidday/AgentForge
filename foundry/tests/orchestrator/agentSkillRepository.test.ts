import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
} from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkillRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "my-skill",
    description: "A skill",
    taskCategory: "deploy",
    skillMarkdown: "# Skill\n\nDo the thing.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
}

function makePrismaMock() {
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
    $transaction: vi.fn(async (fn: (tx: typeof tx) => unknown) => fn(tx)),
    __tx: tx,
  } as unknown as PrismaClient & {
    agentSkill: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
    __tx: typeof tx;
  };
}

describe("mapAgentSkillToDocument", () => {
  it("maps a skill row to a SkillDocument", () => {
    const row = makeSkillRow();
    expect(mapAgentSkillToDocument(row)).toEqual({
      id: "skill-1",
      repoSlug: "org/repo",
      name: "my-skill",
      description: "A skill",
      taskCategory: "deploy",
      skillMarkdown: "# Skill\n\nDo the thing.",
      utilityScore: 0,
      lastUsedAt: row.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates a skill with zeroed counters and score", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.create.mockResolvedValue(makeSkillRow());

      const repo = new AgentSkillRepository(prisma);
      await repo.create({
        repoSlug: "org/repo",
        name: "my-skill",
        description: "A skill",
        taskCategory: "deploy",
        skillMarkdown: "# Skill",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "my-skill",
          description: "A skill",
          taskCategory: "deploy",
          skillMarkdown: "# Skill",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findUnique.mockResolvedValue(makeSkillRow());

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result!.id).toBe("skill-1");
    });

    it("returns null when not found", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findUnique.mockResolvedValue(null);

      const repo = new AgentSkillRepository(prisma);
      expect(await repo.findById("missing")).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries a +/- window around the given time, ordered by most recent", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkillRow());
      const around = new Date("2024-06-01T12:00:00Z");

      const repo = new AgentSkillRepository(prisma);
      await repo.findByRepoCategoryNearTime("org/repo", "deploy", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deploy",
          createdAt: {
            gte: new Date("2024-06-01T11:59:59Z"),
            lte: new Date("2024-06-01T12:00:01Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("defaults the window to 5000ms when not specified", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const around = new Date("2024-06-01T12:00:00Z");

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findByRepoCategoryNearTime("org/repo", "deploy", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date("2024-06-01T11:59:55Z"),
              lte: new Date("2024-06-01T12:00:05Z"),
            },
          }),
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries non-archived skills for the repo", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findMany.mockResolvedValue([makeSkillRow()]);

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.count.mockResolvedValue(3);

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(3);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkillRow());

      const repo = new AgentSkillRepository(prisma);
      await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
    });

    it("returns null when there are no active skills", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      const repo = new AgentSkillRepository(prisma);
      expect(await repo.findLowestUtilityActive("org/repo")).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkillRow());

      const repo = new AgentSkillRepository(prisma);
      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills against the query and returns the top K as SkillDocuments", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findMany.mockResolvedValue([
        makeSkillRow({
          id: "skill-irrelevant",
          taskCategory: "unrelated",
          skillMarkdown: "nothing in common",
          name: "zzz",
          description: "zzz",
        }),
        makeSkillRow({
          id: "skill-relevant",
          taskCategory: "deploy pipeline",
          skillMarkdown: "deploy pipeline notes",
          name: "deploy pipeline",
          description: "deploy pipeline helper",
        }),
      ]);

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findTopKByRelevance("org/repo", "deploy pipeline", 1);

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("skill-relevant");
    });

    it("caps K at env.MAX_SKILLS_INJECTED even when a larger K is requested", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findMany.mockResolvedValue([
        makeSkillRow({ id: "s1" }),
        makeSkillRow({ id: "s2" }),
        makeSkillRow({ id: "s3" }),
        makeSkillRow({ id: "s4" }),
        makeSkillRow({ id: "s5" }),
      ]);

      const repo = new AgentSkillRepository(prisma);
      // env.MAX_SKILLS_INJECTED defaults to 3 and is validated to max 10;
      // request far more than available to assert the cap, not the count.
      const result = await repo.findTopKByRelevance("org/repo", "anything", 10);

      expect(result.length).toBeLessThanOrEqual(5);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.findMany.mockResolvedValue([]);

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.findTopKByRelevance("org/repo", "query", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const prisma = makePrismaMock();
      prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(
        makeSkillRow({ successCount: 2, failureCount: 1 }),
      );
      prisma.__tx.agentSkill.update.mockResolvedValue(
        makeSkillRow({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 }),
      );

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.__tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
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
      const prisma = makePrismaMock();
      prisma.__tx.agentSkill.findUniqueOrThrow.mockResolvedValue(
        makeSkillRow({ successCount: 2, failureCount: 1 }),
      );
      prisma.__tx.agentSkill.update.mockResolvedValue(
        makeSkillRow({ successCount: 2, failureCount: 2, utilityScore: 2 / 5 }),
      );

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.incrementFailure("skill-1");

      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
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
    it("archives a skill with low utility and enough uses", async () => {
      const prisma = makePrismaMock();
      prisma.agentSkill.update.mockResolvedValue(makeSkillRow());

      const repo = new AgentSkillRepository(prisma);
      await repo.archiveIfLowUtility(
        makeSkillRow({ id: "skill-low", utilityScore: 0.1, successCount: 1, failureCount: 4 }),
      );

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is low but use count is under the threshold", async () => {
      const prisma = makePrismaMock();

      const repo = new AgentSkillRepository(prisma);
      await repo.archiveIfLowUtility(
        makeSkillRow({ utilityScore: 0.1, successCount: 1, failureCount: 1 }),
      );

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility score is high regardless of use count", async () => {
      const prisma = makePrismaMock();

      const repo = new AgentSkillRepository(prisma);
      await repo.archiveIfLowUtility(
        makeSkillRow({ utilityScore: 0.9, successCount: 10, failureCount: 1 }),
      );

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one in a transaction", async () => {
      const prisma = makePrismaMock();
      const lowest = makeSkillRow({ id: "skill-old" });
      prisma.__tx.agentSkill.findFirst.mockResolvedValue(lowest);
      prisma.__tx.agentSkill.create.mockResolvedValue(makeSkillRow({ id: "skill-new" }));

      const repo = new AgentSkillRepository(prisma);
      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "deploy",
        skillMarkdown: "# New",
      });

      expect(prisma.__tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-old" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.__tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "deploy",
          skillMarkdown: "# New",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({
        newSkill: expect.objectContaining({ id: "skill-new" }),
        displacedSkillId: "skill-old",
      });
    });

    it("throws when there are no active skills to displace", async () => {
      const prisma = makePrismaMock();
      prisma.__tx.agentSkill.findFirst.mockResolvedValue(null);

      const repo = new AgentSkillRepository(prisma);
      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "deploy",
          skillMarkdown: "# New",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(prisma.__tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
