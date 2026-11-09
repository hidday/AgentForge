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
    name: "retry-flaky-tests",
    description: "Retries flaky tests",
    taskCategory: "testing",
    skillMarkdown: "# Retry flaky tests\nUse exponential backoff.",
    successCount: 3,
    failureCount: 1,
    utilityScore: 0.6,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-02T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
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
  return { prisma: prisma as unknown as PrismaClient, tx, rawPrisma: prisma };
}

describe("AgentSkillRepository", () => {
  let prisma: PrismaClient;
  let tx: ReturnType<typeof makePrisma>["tx"];
  let rawPrisma: ReturnType<typeof makePrisma>["rawPrisma"];
  let repo: AgentSkillRepository;

  beforeEach(() => {
    const built = makePrisma();
    prisma = built.prisma;
    tx = built.tx;
    rawPrisma = built.rawPrisma;
    repo = new AgentSkillRepository(prisma);
  });

  describe("mapAgentSkillToDocument / toSkillDocument", () => {
    it("maps all relevant fields into a SkillDocument", () => {
      const skill = makeSkill();
      const doc = mapAgentSkillToDocument(skill);
      expect(doc).toEqual({
        id: "skill-1",
        repoSlug: "acme/widgets",
        name: "retry-flaky-tests",
        description: "Retries flaky tests",
        taskCategory: "testing",
        skillMarkdown: skill.skillMarkdown,
        utilityScore: 0.6,
        lastUsedAt: skill.lastUsedAt,
      });
    });

    it("preserves null name/description", () => {
      const skill = makeSkill({ name: null, description: null });
      const doc = mapAgentSkillToDocument(skill);
      expect(doc.name).toBeNull();
      expect(doc.description).toBeNull();
    });
  });

  describe("create", () => {
    it("creates with zeroed counters and utility score", async () => {
      (rawPrisma.agentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());

      await repo.create({
        repoSlug: "acme/widgets",
        name: "n",
        description: "d",
        taskCategory: "testing",
        skillMarkdown: "md",
      });

      expect(rawPrisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "n",
          description: "d",
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
    it("returns the matching skill", async () => {
      const skill = makeSkill();
      (rawPrisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(skill);

      const result = await repo.findById("skill-1");

      expect(rawPrisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      (rawPrisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within a time window around the given date using the default window", async () => {
      (rawPrisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      const around = new Date("2026-01-01T00:00:10Z");

      await repo.findByRepoCategoryNearTime("acme/widgets", "testing", around);

      expect(rawPrisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "testing",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("respects a custom window size", async () => {
      (rawPrisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const around = new Date("2026-01-01T00:00:10Z");

      await repo.findByRepoCategoryNearTime("acme/widgets", "testing", around, 1000);

      expect(rawPrisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "acme/widgets",
          taskCategory: "testing",
          createdAt: {
            gte: new Date(around.getTime() - 1000),
            lte: new Date(around.getTime() + 1000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findActiveByRepo", () => {
    it("queries non-archived skills for the repo", async () => {
      (rawPrisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeSkill()]);

      const result = await repo.findActiveByRepo("acme/widgets");

      expect(rawPrisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      (rawPrisma.agentSkill.count as ReturnType<typeof vi.fn>).mockResolvedValue(4);

      const result = await repo.countActiveByRepo("acme/widgets");

      expect(rawPrisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toBe(4);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      (rawPrisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());

      await repo.findLowestUtilityActive("acme/widgets");

      expect(rawPrisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
    });

    it("returns null when there are no active skills", async () => {
      (rawPrisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findLowestUtilityActive("acme/widgets");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      (rawPrisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());

      await repo.archiveById("skill-1");

      expect(rawPrisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = (rawPrisma.agentSkill.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores and ranks active skills by relevance to the query, capped at k", async () => {
      const skills = [
        makeSkill({
          id: "s1",
          name: null,
          description: null,
          taskCategory: "testing",
          skillMarkdown: "flaky test retries",
        }),
        makeSkill({
          id: "s2",
          name: null,
          description: null,
          taskCategory: "deployment",
          skillMarkdown: "deploy to production",
        }),
        makeSkill({
          id: "s3",
          name: null,
          description: null,
          taskCategory: "testing",
          skillMarkdown: "flaky test backoff retries",
        }),
      ];
      (rawPrisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("acme/widgets", "flaky test retries", 2);

      expect(rawPrisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
      });
      expect(result).toHaveLength(2);
      // The two skills most textually similar to the query should be s1 and s3.
      expect(result.map((d) => d.id).sort()).toEqual(["s1", "s3"]);
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `s${i}`, taskCategory: "testing", skillMarkdown: `skill number ${i}` }),
      );
      (rawPrisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("acme/widgets", "skill", 10_000);

      // env.MAX_SKILLS_INJECTED defaults to 3.
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      (rawPrisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findTopKByRelevance("acme/widgets", "anything", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 });
      tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ successCount: 2, failureCount: 1 });
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ successCount: 2, failureCount: 2, utilityScore: 2 / 5 });
      tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementFailure("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / 5,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utility is below 0.2 and total uses are >= 5", async () => {
      (rawPrisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(rawPrisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = (rawPrisma.agentSkill.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.where).toEqual({ id: skill.id });
    });

    it("does not archive when utility is below 0.2 but total uses are under 5", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(rawPrisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utility is at or above 0.2 regardless of usage count", async () => {
      const skill = makeSkill({ utilityScore: 0.2, successCount: 5, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(rawPrisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("boundary: exactly 5 total uses with utility just under 0.2 archives", async () => {
      const skill = makeSkill({ utilityScore: 0.19, successCount: 2, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(rawPrisma.agentSkill.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates a new one in the same transaction", async () => {
      const lowest = makeSkill({ id: "low-1", utilityScore: 0.05 });
      tx.agentSkill.findFirst.mockResolvedValue(lowest);
      const created = makeSkill({ id: "new-1", utilityScore: 0 });
      tx.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("acme/widgets", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "md",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "acme/widgets", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "low-1" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "acme/widgets",
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "low-1" });
    });

    it("throws when there are no active skills to displace", async () => {
      tx.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("acme/widgets", {
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "md",
        }),
      ).rejects.toThrow("No active skills found for repo acme/widgets to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
