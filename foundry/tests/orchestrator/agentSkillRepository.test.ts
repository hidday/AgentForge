import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

vi.mock("../../src/utils/similarity.js", () => ({
  scoreSkillRelevance: vi.fn(),
}));

import { scoreSkillRelevance } from "../../src/utils/similarity.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "do-the-thing",
    description: "does the thing",
    taskCategory: "backend",
    skillMarkdown: "# Do the thing",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
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
  return { prisma: prisma as unknown as PrismaClient, tx };
}

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>["prisma"];
  let tx: ReturnType<typeof makePrisma>["tx"];
  let repo: AgentSkillRepository;

  beforeEach(() => {
    const built = makePrisma();
    prisma = built.prisma;
    tx = built.tx;
    repo = new AgentSkillRepository(prisma);
    vi.mocked(scoreSkillRelevance).mockReset();
  });

  describe("mapAgentSkillToDocument / toSkillDocument", () => {
    it("maps an AgentSkill row to a SkillDocument shape", () => {
      const skill = makeSkill({ id: "s1", name: "n", description: "d" });
      const doc = mapAgentSkillToDocument(skill);
      expect(doc).toEqual({
        id: "s1",
        repoSlug: "org/repo",
        name: "n",
        description: "d",
        taskCategory: "backend",
        skillMarkdown: "# Do the thing",
        utilityScore: 0,
        lastUsedAt: skill.lastUsedAt,
      });
    });
  });

  describe("create", () => {
    it("creates a skill with zeroed counters and utility score", async () => {
      const created = makeSkill();
      (prisma.agentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "do-the-thing",
        description: "does the thing",
        taskCategory: "backend",
        skillMarkdown: "# Do the thing",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "do-the-thing",
          description: "does the thing",
          taskCategory: "backend",
          skillMarkdown: "# Do the thing",
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
      const skill = makeSkill();
      (prisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(skill);

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      (prisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window around the given time", async () => {
      const skill = makeSkill();
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(skill);
      const around = new Date("2026-01-01T00:00:10.000Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "backend", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05.000Z"),
            lte: new Date("2026-01-01T00:00:15.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(skill);
    });

    it("honors a custom windowMs", async () => {
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const around = new Date("2026-01-01T00:00:10.000Z");

      const result = await repo.findByRepoCategoryNearTime("org/repo", "backend", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "backend",
          createdAt: {
            gte: new Date("2026-01-01T00:00:09.000Z"),
            lte: new Date("2026-01-01T00:00:11.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries active (non-archived) skills for the repo", async () => {
      const skills = [makeSkill()];
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts active skills for the repo", async () => {
      (prisma.agentSkill.count as ReturnType<typeof vi.fn>).mockResolvedValue(7);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      const skill = makeSkill();
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(skill);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when no active skills exist", async () => {
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores, sorts descending, and slices to k when k is below MAX_SKILLS_INJECTED", async () => {
      const low = makeSkill({ id: "low", name: "low" });
      const high = makeSkill({ id: "high", name: "high" });
      const mid = makeSkill({ id: "mid", name: "mid" });
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([low, high, mid]);
      vi.mocked(scoreSkillRelevance).mockImplementation((skill) => {
        const scores: Record<string, number> = { low: 0.1, high: 0.9, mid: 0.5 };
        return scores[skill.name as string];
      });

      const result = await repo.findTopKByRelevance("org/repo", "some query", 1);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("high");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = [
        makeSkill({ id: "a", name: "a" }),
        makeSkill({ id: "b", name: "b" }),
        makeSkill({ id: "c", name: "c" }),
        makeSkill({ id: "d", name: "d" }),
      ];
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
      vi.mocked(scoreSkillRelevance).mockImplementation((skill) => {
        const order: Record<string, number> = { a: 1, b: 4, c: 3, d: 2 };
        return order[skill.name as string];
      });

      // MAX_SKILLS_INJECTED defaults to 3, so requesting 10 must still cap at 3.
      const result = await repo.findTopKByRelevance("org/repo", "some query", 10);

      expect(result).toHaveLength(3);
      expect(result.map((s) => s.id)).toEqual(["b", "c", "d"]);
    });

    it("returns an empty array when there are no active skills", async () => {
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findTopKByRelevance("org/repo", "query", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ id: "skill-1", successCount: 3 });
      tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(tx.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = tx.agentSkill.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.successCount).toBe(3);
      expect(call.data.utilityScore).toBeCloseTo(3 / 5); // 3 / (3 + 1 + 1)
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toBe(updated);
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ id: "skill-1", failureCount: 2 });
      tx.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementFailure("skill-1");

      expect(tx.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      const call = tx.agentSkill.update.mock.calls[0][0];
      expect(call.data.failureCount).toBe(2);
      expect(call.data.utilityScore).toBeCloseTo(2 / 5); // 2 / (2 + 2 + 1)
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utility is below 0.2 and it has been used at least 5 times", async () => {
      (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.1, successCount: 2, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is at or above 0.2", async () => {
      const skill = makeSkill({ utilityScore: 0.2, successCount: 4, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses are below 5, even with low utility", async () => {
      const skill = makeSkill({ utilityScore: 0.05, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one inside a transaction", async () => {
      const lowest = makeSkill({ id: "lowest", utilityScore: 0.01 });
      tx.agentSkill.findFirst.mockResolvedValue(lowest);
      const newSkill = makeSkill({ id: "new-skill" });
      tx.agentSkill.create.mockResolvedValue(newSkill);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-name",
        description: "new-desc",
        taskCategory: "backend",
        skillMarkdown: "# New",
      });

      expect(tx.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-name",
          description: "new-desc",
          taskCategory: "backend",
          skillMarkdown: "# New",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "lowest" });
    });

    it("throws when there are no active skills to displace", async () => {
      tx.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-name",
          description: "new-desc",
          taskCategory: "backend",
          skillMarkdown: "# New",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(tx.agentSkill.update).not.toHaveBeenCalled();
      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
