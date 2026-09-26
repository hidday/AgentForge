import { describe, it, expect, vi } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "acme/widgets",
    name: "fix-lint",
    description: "Fixes lint errors",
    taskCategory: "lint",
    skillMarkdown: "# Fix lint\nRun the linter and fix issues.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    lastUsedAt: new Date("2024-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
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
  };
}

describe("mapAgentSkillToDocument", () => {
  it("maps a raw skill row to a SkillDocument, dropping successCount/failureCount/archivedAt", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill);

    expect(doc).toEqual({
      id: "skill-1",
      repoSlug: "acme/widgets",
      name: "fix-lint",
      description: "Fixes lint errors",
      taskCategory: "lint",
      skillMarkdown: "# Fix lint\nRun the linter and fix issues.",
      utilityScore: 0,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("calls prisma.agentSkill.create with zeroed counters/utility and the given fields", async () => {
      const prisma = makePrisma();
      const row = makeSkill();
      prisma.agentSkill.create.mockResolvedValue(row);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.create({
        repoSlug: "acme/widgets",
        name: "fix-lint",
        description: "Fixes lint errors",
        taskCategory: "lint",
        skillMarkdown: "# Fix lint",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "fix-lint",
          description: "Fixes lint errors",
          taskCategory: "lint",
          skillMarkdown: "# Fix lint",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual(row);
    });

    it("propagates errors from prisma.agentSkill.create", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.create.mockRejectedValue(new Error("insert failed"));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.create({
          repoSlug: "acme/widgets",
          name: "x",
          description: "y",
          taskCategory: "z",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("findById", () => {
    it("queries by id and returns the row", async () => {
      const prisma = makePrisma();
      const row = makeSkill();
      prisma.agentSkill.findUnique.mockResolvedValue(row);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toEqual(row);
    });

    it("returns null when not found", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findUnique.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });

    it("propagates errors from prisma.agentSkill.findUnique", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findUnique.mockRejectedValue(new Error("db error"));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.findById("skill-1")).rejects.toThrow("db error");
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries with a time window derived from the given windowMs and orders by createdAt desc", async () => {
      const prisma = makePrisma();
      const row = makeSkill();
      prisma.agentSkill.findFirst.mockResolvedValue(row);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2024-06-01T12:00:00Z");

      const result = await repo.findByRepoCategoryNearTime("acme/widgets", "lint", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "lint",
          createdAt: {
            gte: new Date("2024-06-01T11:59:59.000Z"),
            lte: new Date("2024-06-01T12:00:01.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(row);
    });

    it("defaults the window to 5000ms when not provided", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);
      const around = new Date("2024-06-01T12:00:00Z");

      await repo.findByRepoCategoryNearTime("acme/widgets", "lint", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "lint",
          createdAt: {
            gte: new Date("2024-06-01T11:59:55.000Z"),
            lte: new Date("2024-06-01T12:00:05.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when nothing is found in the window", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findByRepoCategoryNearTime(
        "acme/widgets",
        "lint",
        new Date(),
      );

      expect(result).toBeNull();
    });

    it("propagates errors from prisma.agentSkill.findFirst", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockRejectedValue(new Error("boom"));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.findByRepoCategoryNearTime("acme/widgets", "lint", new Date()),
      ).rejects.toThrow("boom");
    });
  });

  describe("findActiveByRepo", () => {
    it("queries for non-archived skills by repoSlug", async () => {
      const prisma = makePrisma();
      const rows = [makeSkill({ id: "s1" }), makeSkill({ id: "s2" })];
      prisma.agentSkill.findMany.mockResolvedValue(rows);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findActiveByRepo("acme/widgets");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toEqual(rows);
    });

    it("propagates errors from prisma.agentSkill.findMany", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findMany.mockRejectedValue(new Error("db down"));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.findActiveByRepo("acme/widgets")).rejects.toThrow("db down");
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills by repoSlug", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.count.mockResolvedValue(4);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.countActiveByRepo("acme/widgets");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toBe(4);
    });

    it("propagates errors from prisma.agentSkill.count", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.count.mockRejectedValue(new Error("count failed"));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.countActiveByRepo("acme/widgets")).rejects.toThrow("count failed");
    });
  });

  describe("findLowestUtilityActive", () => {
    it("queries active skills ordered by utilityScore asc then lastUsedAt asc", async () => {
      const prisma = makePrisma();
      const row = makeSkill({ utilityScore: 0.1 });
      prisma.agentSkill.findFirst.mockResolvedValue(row);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("acme/widgets");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toEqual(row);
    });

    it("returns null when there are no active skills", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockResolvedValue(null);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findLowestUtilityActive("acme/widgets");

      expect(result).toBeNull();
    });

    it("propagates errors from prisma.agentSkill.findFirst", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findFirst.mockRejectedValue(new Error("fail"));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.findLowestUtilityActive("acme/widgets")).rejects.toThrow("fail");
    });
  });

  describe("archiveById", () => {
    it("calls prisma.agentSkill.update with an archivedAt timestamp", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as never);

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });

    it("propagates errors from prisma.agentSkill.update", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.update.mockRejectedValue(new Error("update failed"));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.archiveById("skill-1")).rejects.toThrow("update failed");
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills against the query, sorts descending, and caps at min(k, MAX_SKILLS_INJECTED)", async () => {
      const prisma = makePrisma();
      const rows = [
        makeSkill({
          id: "s-low",
          taskCategory: "unrelated",
          skillMarkdown: "totally different content here",
          name: "other",
          description: "other thing",
        }),
        makeSkill({
          id: "s-high",
          taskCategory: "fix lint errors",
          skillMarkdown: "fix lint errors in the codebase",
          name: "fix-lint",
          description: "fix lint errors",
        }),
        makeSkill({
          id: "s-mid",
          taskCategory: "fix",
          skillMarkdown: "fix something else",
          name: "fix-other",
          description: "fix other",
        }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(rows);
      const repo = new AgentSkillRepository(prisma as never);

      // MAX_SKILLS_INJECTED default is 3, so k=10 should be capped to 3 (all rows).
      const result = await repo.findTopKByRelevance("acme/widgets", "fix lint errors", 10);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe("s-high");
      // Each returned item is a SkillDocument (no successCount/failureCount/archivedAt).
      expect(result[0]).not.toHaveProperty("successCount");
      expect(result[0]).not.toHaveProperty("archivedAt");
    });

    it("caps results at k when k is smaller than MAX_SKILLS_INJECTED", async () => {
      const prisma = makePrisma();
      const rows = [
        makeSkill({ id: "s1", taskCategory: "lint" }),
        makeSkill({ id: "s2", taskCategory: "lint" }),
        makeSkill({ id: "s3", taskCategory: "lint" }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(rows);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("acme/widgets", "lint", 1);

      expect(result).toHaveLength(1);
    });

    it("returns an empty array when there are no active skills", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findMany.mockResolvedValue([]);
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.findTopKByRelevance("acme/widgets", "lint", 5);

      expect(result).toEqual([]);
    });

    it("propagates errors from the underlying findActiveByRepo query", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.findMany.mockRejectedValue(new Error("db down"));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.findTopKByRelevance("acme/widgets", "lint", 5)).rejects.toThrow(
        "db down",
      );
    });
  });

  describe("incrementSuccess", () => {
    it("runs inside a transaction, increments successCount, recomputes utilityScore, and updates lastUsedAt", async () => {
      const prisma = makePrisma();
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      const updated = makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 });

      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue(updated),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      const updateCall = tx.agentSkill.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: "skill-1" });
      expect(updateCall.data.successCount).toBe(3);
      // utilityScore = newSuccessCount / (newSuccessCount + failureCount + 1) = 3 / (3+1+1) = 0.6
      expect(updateCall.data.utilityScore).toBeCloseTo(0.6);
      expect(updateCall.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toEqual(updated);
    });

    it("propagates errors when the skill is not found (findUniqueOrThrow rejects)", async () => {
      const prisma = makePrisma();
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockRejectedValue(new Error("not found")),
          update: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.incrementSuccess("missing")).rejects.toThrow("not found");
      expect(tx.agentSkill.update).not.toHaveBeenCalled();
    });

    it("propagates errors from the transaction update step", async () => {
      const prisma = makePrisma();
      const existing = makeSkill({ successCount: 0, failureCount: 0 });
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockRejectedValue(new Error("update failed")),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.incrementSuccess("skill-1")).rejects.toThrow("update failed");
    });
  });

  describe("incrementFailure", () => {
    it("runs inside a transaction, increments failureCount, and recomputes utilityScore based on successCount", async () => {
      const prisma = makePrisma();
      const existing = makeSkill({ successCount: 1, failureCount: 1 });
      const updated = makeSkill({ successCount: 1, failureCount: 2, utilityScore: 1 / 4 });

      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue(updated),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.incrementFailure("skill-1");

      const updateCall = tx.agentSkill.update.mock.calls[0][0];
      expect(updateCall.data.failureCount).toBe(2);
      // utilityScore = successCount / (successCount + newFailureCount + 1) = 1 / (1+2+1) = 0.25
      expect(updateCall.data.utilityScore).toBeCloseTo(0.25);
      expect(updateCall.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toEqual(updated);
    });

    it("propagates errors from the transaction", async () => {
      const prisma = makePrisma();
      const tx = {
        agentSkill: {
          findUniqueOrThrow: vi.fn().mockRejectedValue(new Error("not found")),
          update: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(repo.incrementFailure("missing")).rejects.toThrow("not found");
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore is below 0.2 and total uses is at least 5", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "skill-x", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-x" },
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      });
    });

    it("does not archive when utilityScore is below 0.2 but total uses is under 5", async () => {
      const prisma = makePrisma();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "skill-x", utilityScore: 0.1, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utilityScore is at or above 0.2 even with many uses", async () => {
      const prisma = makePrisma();
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "skill-x", utilityScore: 0.2, successCount: 5, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("propagates errors from the underlying archiveById update", async () => {
      const prisma = makePrisma();
      prisma.agentSkill.update.mockRejectedValue(new Error("archive failed"));
      const repo = new AgentSkillRepository(prisma as never);
      const skill = makeSkill({ id: "skill-x", utilityScore: 0.05, successCount: 1, failureCount: 5 });

      await expect(repo.archiveIfLowUtility(skill)).rejects.toThrow("archive failed");
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a new one within a transaction", async () => {
      const prisma = makePrisma();
      const lowest = makeSkill({ id: "lowest-skill", utilityScore: 0.01 });
      const created = makeSkill({ id: "new-skill", name: "new-name" });

      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(lowest),
          update: vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() }),
          create: vi.fn().mockResolvedValue(created),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      const result = await repo.displaceAndCreate("acme/widgets", {
        name: "new-name",
        description: "new desc",
        taskCategory: "lint",
        skillMarkdown: "# New",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest-skill" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "new-name",
          description: "new desc",
          taskCategory: "lint",
          skillMarkdown: "# New",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "lowest-skill" });
    });

    it("throws when there are no active skills to displace, without creating a new one", async () => {
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
        repo.displaceAndCreate("acme/widgets", {
          name: "new-name",
          description: "new desc",
          taskCategory: "lint",
          skillMarkdown: "# New",
        }),
      ).rejects.toThrow("No active skills found for repo acme/widgets to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });

    it("propagates errors from the create step", async () => {
      const prisma = makePrisma();
      const lowest = makeSkill({ id: "lowest-skill" });
      const tx = {
        agentSkill: {
          findFirst: vi.fn().mockResolvedValue(lowest),
          update: vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() }),
          create: vi.fn().mockRejectedValue(new Error("create failed")),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const repo = new AgentSkillRepository(prisma as never);

      await expect(
        repo.displaceAndCreate("acme/widgets", {
          name: "new-name",
          description: "new desc",
          taskCategory: "lint",
          skillMarkdown: "# New",
        }),
      ).rejects.toThrow("create failed");
    });
  });
});
