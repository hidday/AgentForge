import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { env } from "../../src/config/env.js";

vi.mock("../../src/utils/similarity.js", () => ({
  scoreSkillRelevance: vi.fn(),
}));

import { scoreSkillRelevance } from "../../src/utils/similarity.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "some-skill",
    description: "A skill",
    taskCategory: "testing",
    skillMarkdown: "# Some skill\nDo the thing.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  } as AgentSkill;
}

function makePrismaMock() {
  const base = {
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
  // $transaction invokes the callback with the same mock object standing in for `tx`.
  base.$transaction.mockImplementation(async (cb: (tx: typeof base) => unknown) => cb(base));
  return base as unknown as PrismaClient & { agentSkill: Record<string, ReturnType<typeof vi.fn>> };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument", () => {
    const skill = makeSkill({
      id: "skill-99",
      repoSlug: "org/repo",
      name: "deploy-skill",
      description: "Deploys things",
      taskCategory: "deployment",
      skillMarkdown: "# Deploy\n...",
      utilityScore: 0.42,
    });

    const doc = mapAgentSkillToDocument(skill);

    expect(doc).toEqual({
      id: "skill-99",
      repoSlug: "org/repo",
      name: "deploy-skill",
      description: "Deploys things",
      taskCategory: "deployment",
      skillMarkdown: "# Deploy\n...",
      utilityScore: 0.42,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new AgentSkillRepository(prisma as unknown as PrismaClient);
    vi.mocked(scoreSkillRelevance).mockReset();
  });

  describe("create", () => {
    it("creates a skill with zeroed counters and score", async () => {
      const created = makeSkill({ id: "new-skill" });
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
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
      prisma.agentSkill.findUnique.mockResolvedValue(skill);

      const result = await repo.findById("skill-42");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-42" } });
      expect(result).toBe(skill);
    });

    it("returns null when not found", async () => {
      prisma.agentSkill.findUnique.mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default 5s window around the given time", async () => {
      const around = new Date("2026-03-15T12:00:00.000Z");
      prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());

      await repo.findByRepoCategoryNearTime("org/repo", "testing", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "testing",
          createdAt: {
            gte: new Date("2026-03-15T11:59:55.000Z"),
            lte: new Date("2026-03-15T12:00:05.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("honors a custom window size", async () => {
      const around = new Date("2026-03-15T12:00:00.000Z");
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      const result = await repo.findByRepoCategoryNearTime("org/repo", "testing", around, 1000);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "testing",
          createdAt: {
            gte: new Date("2026-03-15T11:59:59.000Z"),
            lte: new Date("2026-03-15T12:00:01.000Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries non-archived skills for the repo", async () => {
      const skills = [makeSkill({ id: "a" }), makeSkill({ id: "b" })];
      prisma.agentSkill.findMany.mockResolvedValue(skills);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(skills);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts non-archived skills for the repo", async () => {
      prisma.agentSkill.count.mockResolvedValue(7);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore then lastUsedAt ascending", async () => {
      const skill = makeSkill({ id: "lowest" });
      prisma.agentSkill.findFirst.mockResolvedValue(skill);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(skill);
    });

    it("returns null when there are no active skills", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to a Date", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = prisma.agentSkill.update.mock.calls[0][0] as {
        where: { id: string };
        data: { archivedAt: Date };
      };
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills, sorts by score descending, and slices to k", async () => {
      const skills = [
        makeSkill({ id: "low", taskCategory: "low" }),
        makeSkill({ id: "high", taskCategory: "high" }),
        makeSkill({ id: "mid", taskCategory: "mid" }),
      ];
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      vi.mocked(scoreSkillRelevance).mockImplementation((skill) => {
        if (skill.taskCategory === "high") return 0.9;
        if (skill.taskCategory === "mid") return 0.5;
        return 0.1;
      });

      const result = await repo.findTopKByRelevance("org/repo", "deploy the app", 2);

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result.map((d) => d.id)).toEqual(["high", "mid"]);
    });

    it("caps the result at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const skills = Array.from({ length: 5 }, (_, i) =>
        makeSkill({ id: `s${i}`, taskCategory: `cat${i}` }),
      );
      prisma.agentSkill.findMany.mockResolvedValue(skills);
      vi.mocked(scoreSkillRelevance).mockImplementation((skill) => {
        const idx = Number(skill.taskCategory.replace("cat", ""));
        // Higher index -> higher score, so ordering is deterministic (s4 best, s0 worst).
        return idx;
      });

      const result = await repo.findTopKByRelevance("org/repo", "query", 10);

      expect(result).toHaveLength(env.MAX_SKILLS_INJECTED);
      expect(result.map((d) => d.id)).toEqual(["s4", "s3", "s2"]);
    });

    it("returns an empty array when there are no active skills", async () => {
      prisma.agentSkill.findMany.mockResolvedValue([]);

      const result = await repo.findTopKByRelevance("org/repo", "query", 3);

      expect(result).toEqual([]);
      expect(scoreSkillRelevance).not.toHaveBeenCalled();
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore via a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ id: "skill-1", successCount: 3, utilityScore: 0.6 });
      prisma.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
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
    it("increments failureCount and recomputes utilityScore via a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 4, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      const updated = makeSkill({ id: "skill-1", failureCount: 2, utilityScore: 4 / 7 });
      prisma.agentSkill.update.mockResolvedValue(updated);

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 4 / 7,
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utilityScore is below 0.2 and totalUses is at least 5", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.19, successCount: 3, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does NOT archive when utilityScore is exactly 0.2 (boundary is strictly less-than)", async () => {
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.2, successCount: 3, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does NOT archive when totalUses is just under 5", async () => {
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.1, successCount: 2, failureCount: 2 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("archives at exactly 5 total uses when utilityScore is below the threshold", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.05, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does NOT archive when utilityScore is high even with many uses", async () => {
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.9, successCount: 8, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("throws when there is no active skill to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });

    it("archives the lowest-utility skill and creates the new one within a transaction", async () => {
      const lowestUtility = makeSkill({ id: "to-displace", utilityScore: 0.05 });
      prisma.agentSkill.findFirst.mockResolvedValue(lowestUtility);
      const newSkill = makeSkill({ id: "brand-new", name: "new" });
      prisma.agentSkill.create.mockResolvedValue(newSkill);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "# md",
      });

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "to-displace" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# md",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill, displacedSkillId: "to-displace" });
    });
  });
});
