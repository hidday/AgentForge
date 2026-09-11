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
    repoSlug: "acme/widgets",
    name: "widget-builder",
    description: "Builds widgets",
    taskCategory: "build",
    skillMarkdown: "# Widget Builder\nDo the widget thing.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function buildPrisma() {
  const tx = {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };

  const prisma = {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
  };

  return { prisma: prisma as unknown as PrismaClient, prismaMock: prisma, tx };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument, preserving key fields", () => {
    const skill = makeSkill({ id: "s9", utilityScore: 0.75 });
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: "s9",
      repoSlug: "acme/widgets",
      name: "widget-builder",
      description: "Builds widgets",
      taskCategory: "build",
      skillMarkdown: skill.skillMarkdown,
      utilityScore: 0.75,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  let prisma: PrismaClient;
  let prismaMock: ReturnType<typeof buildPrisma>["prismaMock"];
  let tx: ReturnType<typeof buildPrisma>["tx"];
  let repo: AgentSkillRepository;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    prismaMock = built.prismaMock;
    tx = built.tx;
    repo = new AgentSkillRepository(prisma);
  });

  describe("create", () => {
    it("creates a skill with zeroed counters and score", async () => {
      const created = makeSkill();
      prismaMock.agentSkill.create.mockResolvedValue(created);

      const result = await repo.create({
        repoSlug: "acme/widgets",
        name: "widget-builder",
        description: "Builds widgets",
        taskCategory: "build",
        skillMarkdown: "# md",
      });

      expect(prismaMock.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "widget-builder",
          description: "Builds widgets",
          taskCategory: "build",
          skillMarkdown: "# md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toBe(created);
    });

    it("propagates errors from the underlying create call", async () => {
      prismaMock.agentSkill.create.mockRejectedValue(new Error("db down"));
      await expect(
        repo.create({
          repoSlug: "acme/widgets",
          name: "x",
          description: "y",
          taskCategory: "build",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("db down");
    });
  });

  describe("findById", () => {
    it("passes the id through to findUnique and returns the row", async () => {
      const skill = makeSkill({ id: "abc" });
      prismaMock.agentSkill.findUnique.mockResolvedValue(skill);
      const result = await repo.findById("abc");
      expect(prismaMock.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "abc" } });
      expect(result).toBe(skill);
    });

    it("returns null when no matching row exists", async () => {
      prismaMock.agentSkill.findUnique.mockResolvedValue(null);
      const result = await repo.findById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries with a time window derived from the given windowMs", async () => {
      const around = new Date("2024-06-01T12:00:00Z");
      const skill = makeSkill();
      prismaMock.agentSkill.findFirst.mockResolvedValue(skill);

      const result = await repo.findByRepoCategoryNearTime("acme/widgets", "build", around, 1000);

      expect(prismaMock.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "build",
          createdAt: {
            gte: new Date("2024-06-01T11:59:59Z"),
            lte: new Date("2024-06-01T12:00:01Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("defaults windowMs to 5000ms when not provided", async () => {
      const around = new Date("2024-06-01T12:00:00Z");
      prismaMock.agentSkill.findFirst.mockResolvedValue(null);

      await repo.findByRepoCategoryNearTime("acme/widgets", "build", around);

      expect(prismaMock.agentSkill.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date("2024-06-01T11:59:55Z"),
              lte: new Date("2024-06-01T12:00:05Z"),
            },
          }),
        }),
      );
    });
  });

  describe("findActiveByRepo", () => {
    it("filters by repoSlug and archivedAt: null", async () => {
      const skills = [makeSkill({ id: "1" }), makeSkill({ id: "2" })];
      prismaMock.agentSkill.findMany.mockResolvedValue(skills);
      const result = await repo.findActiveByRepo("acme/widgets");
      expect(prismaMock.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts active skills for the repo", async () => {
      prismaMock.agentSkill.count.mockResolvedValue(4);
      const result = await repo.countActiveByRepo("acme/widgets");
      expect(prismaMock.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      const skill = makeSkill({ id: "lowest" });
      prismaMock.agentSkill.findFirst.mockResolvedValue(skill);
      const result = await repo.findLowestUtilityActive("acme/widgets");
      expect(prismaMock.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when no active skills exist", async () => {
      prismaMock.agentSkill.findFirst.mockResolvedValue(null);
      const result = await repo.findLowestUtilityActive("acme/widgets");
      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date for the given id", async () => {
      prismaMock.agentSkill.update.mockResolvedValue(makeSkill());
      await repo.archiveById("skill-1");
      expect(prismaMock.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("propagates errors from the update call", async () => {
      prismaMock.agentSkill.update.mockRejectedValue(new Error("not found"));
      await expect(repo.archiveById("missing")).rejects.toThrow("not found");
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance and returns the top k as SkillDocuments", async () => {
      const irrelevant = makeSkill({
        id: "irrelevant",
        taskCategory: "unrelated-topic",
        skillMarkdown: "Completely unrelated content about gardening tools.",
        name: "gardening",
        description: "gardening stuff",
      });
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "authentication",
        skillMarkdown: "How to implement OAuth2 authentication flows for APIs.",
        name: "oauth-helper",
        description: "OAuth2 authentication helper",
      });
      prismaMock.agentSkill.findMany.mockResolvedValue([irrelevant, relevant]);

      const result = await repo.findTopKByRelevance("acme/widgets", "OAuth2 authentication", 1);

      expect(prismaMock.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("relevant");
    });

    it("caps k at env.MAX_SKILLS_INJECTED (default 3) even when a larger k is requested", async () => {
      const skills = Array.from({ length: 6 }, (_, i) =>
        makeSkill({ id: `s${i}`, taskCategory: `cat-${i}`, skillMarkdown: `md-${i}` }),
      );
      prismaMock.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("acme/widgets", "cat", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      prismaMock.agentSkill.findMany.mockResolvedValue([]);
      const result = await repo.findTopKByRelevance("acme/widgets", "anything", 3);
      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore within a transaction", async () => {
      const existing = makeSkill({ id: "s1", successCount: 2, failureCount: 1, utilityScore: 0.5 });
      const updated = makeSkill({ id: "s1", successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("s1");

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "s1" } });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: {
          successCount: 3,
          utilityScore: 3 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });

    it("propagates errors when the skill does not exist", async () => {
      tx.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("no record found"));
      await expect(repo.incrementSuccess("missing")).rejects.toThrow("no record found");
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore within a transaction", async () => {
      const existing = makeSkill({ id: "s1", successCount: 2, failureCount: 1, utilityScore: 0.5 });
      const updated = makeSkill({ id: "s1", successCount: 2, failureCount: 2, utilityScore: 2 / 5 });
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementFailure("s1");

      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });

    it("propagates errors from the transaction", async () => {
      tx.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("boom"));
      await expect(repo.incrementFailure("s1")).rejects.toThrow("boom");
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utilityScore is below 0.2 and total uses is at or above 5", async () => {
      prismaMock.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "s1", utilityScore: 0.1, successCount: 2, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(prismaMock.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is exactly 0.2 (boundary, not below)", async () => {
      const skill = makeSkill({ id: "s1", utilityScore: 0.2, successCount: 3, failureCount: 3 });
      await repo.archiveIfLowUtility(skill);
      expect(prismaMock.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when totalUses is below 5, even with low utility", async () => {
      const skill = makeSkill({ id: "s1", utilityScore: 0.05, successCount: 1, failureCount: 2 });
      await repo.archiveIfLowUtility(skill);
      expect(prismaMock.agentSkill.update).not.toHaveBeenCalled();
    });

    it("archives at exactly totalUses === 5 (boundary)", async () => {
      prismaMock.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "s1", utilityScore: 0.1, successCount: 2, failureCount: 3 });
      await repo.archiveIfLowUtility(skill);
      expect(prismaMock.agentSkill.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one within a transaction", async () => {
      const lowest = makeSkill({ id: "old-1", utilityScore: 0.05 });
      const created = makeSkill({ id: "new-1", name: "new-skill" });
      tx.agentSkill.findFirst.mockResolvedValue(lowest);
      tx.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      tx.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("acme/widgets", {
        name: "new-skill",
        description: "desc",
        taskCategory: "build",
        skillMarkdown: "md",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "old-1" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "new-skill",
          description: "desc",
          taskCategory: "build",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "old-1" });
    });

    it("throws when there is no active skill to displace", async () => {
      tx.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("acme/widgets", {
          name: "new-skill",
          description: "desc",
          taskCategory: "build",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo acme/widgets to displace");

      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
