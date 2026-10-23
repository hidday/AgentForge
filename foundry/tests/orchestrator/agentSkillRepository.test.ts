import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "deploy-helper",
    description: "Helps deploy",
    taskCategory: "deployment",
    skillMarkdown: "# Deploy helper\nSome markdown content about deploying things.",
    utilityScore: 0.5,
    successCount: 1,
    failureCount: 1,
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as unknown as AgentSkill;
}

function makePrisma() {
  const agentSkill = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  const prisma = {
    agentSkill,
    $transaction: vi.fn(async (cb: (tx: { agentSkill: typeof agentSkill }) => unknown) =>
      cb({ agentSkill }),
    ),
  };
  return prisma as unknown as PrismaClient & { agentSkill: typeof agentSkill };
}

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new AgentSkillRepository(prisma);
  });

  describe("mapAgentSkillToDocument", () => {
    it("maps the prisma row fields onto a SkillDocument", () => {
      const skill = makeSkill();
      const doc = mapAgentSkillToDocument(skill);

      expect(doc).toEqual({
        id: "skill-1",
        repoSlug: "org/repo",
        name: "deploy-helper",
        description: "Helps deploy",
        taskCategory: "deployment",
        skillMarkdown: skill.skillMarkdown,
        utilityScore: 0.5,
        lastUsedAt: skill.lastUsedAt,
      });
    });
  });

  describe("create", () => {
    it("initializes counters and utility score to zero", async () => {
      (prisma.agentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());

      await repo.create({
        repoSlug: "org/repo",
        name: "n",
        description: "d",
        taskCategory: "c",
        skillMarkdown: "m",
      });

      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "n",
          description: "d",
          taskCategory: "c",
          skillMarkdown: "m",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
    });

    it("propagates database errors", async () => {
      (prisma.agentSkill.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("write failed"),
      );

      await expect(
        repo.create({ repoSlug: "r", name: "n", description: "d", taskCategory: "c", skillMarkdown: "m" }),
      ).rejects.toThrow("write failed");
    });
  });

  describe("findById", () => {
    it("returns the skill when found", async () => {
      (prisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());

      const result = await repo.findById("skill-1");

      expect(prisma.agentSkill.findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result?.id).toBe("skill-1");
    });

    it("returns null when not found", async () => {
      (prisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries within the default +/-5s window around the given time", async () => {
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      const around = new Date("2026-01-01T00:00:10Z");

      await repo.findByRepoCategoryNearTime("org/repo", "deployment", around);

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date("2026-01-01T00:00:05Z"),
            lte: new Date("2026-01-01T00:00:15Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("honors a custom window size", async () => {
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const around = new Date("2026-01-01T00:01:00Z");

      const result = await repo.findByRepoCategoryNearTime(
        "org/repo",
        "deployment",
        around,
        1000,
      );

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "deployment",
          createdAt: {
            gte: new Date("2026-01-01T00:00:59Z"),
            lte: new Date("2026-01-01T00:01:01Z"),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries only non-archived skills for the repo", async () => {
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeSkill()]);

      const result = await repo.findActiveByRepo("org/repo");

      expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when the repo has no active skills", async () => {
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findActiveByRepo("org/repo");

      expect(result).toEqual([]);
    });
  });

  describe("countActiveByRepo", () => {
    it("returns the count reported by prisma", async () => {
      (prisma.agentSkill.count as ReturnType<typeof vi.fn>).mockResolvedValue(7);

      const result = await repo.countActiveByRepo("org/repo");

      expect(prisma.agentSkill.count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utility score then last used ascending", async () => {
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());

      await repo.findLowestUtilityActive("org/repo");

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
    });

    it("returns null when there are no active skills", async () => {
      (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time", async () => {
      (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());

      await repo.archiveById("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledTimes(1);
      const call = (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance to the query and caps at k", async () => {
      const skills = [
        makeSkill({ id: "s-low", taskCategory: "unrelated", skillMarkdown: "nothing matches" }),
        makeSkill({
          id: "s-high",
          taskCategory: "deployment",
          skillMarkdown: "deployment pipeline configuration",
        }),
      ];
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);

      const result = await repo.findTopKByRelevance("org/repo", "deployment pipeline", 1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("s-high");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = Array.from({ length: 5 }, (_, i) =>
        makeSkill({ id: `s-${i}`, taskCategory: `cat${i}` }),
      );
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);

      // MAX_SKILLS_INJECTED defaults to 3, so even k=10 should yield at most 3 results.
      const result = await repo.findTopKByRelevance("org/repo", "query", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findTopKByRelevance("org/repo", "anything", 3);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ successCount: 3, failureCount: 1, utilityScore: 3 / 5 }),
      );

      const result = await repo.incrementSuccess("skill-1");

      expect(prisma.agentSkill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "skill-1" },
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          successCount: 3,
          utilityScore: 3 / 5,
        }),
      });
      expect(result.successCount).toBe(3);
    });

    it("propagates errors when the skill does not exist", async () => {
      prisma.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("No record found"));

      await expect(repo.incrementSuccess("missing")).rejects.toThrow("No record found");
      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount and recomputes utilityScore inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(existing);
      prisma.agentSkill.update.mockResolvedValue(
        makeSkill({ successCount: 2, failureCount: 2, utilityScore: 2 / 5 }),
      );

      const result = await repo.incrementFailure("skill-1");

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          failureCount: 2,
          utilityScore: 2 / 5,
        }),
      });
      expect(result.failureCount).toBe(2);
    });

    it("propagates errors when the skill does not exist", async () => {
      prisma.agentSkill.findUniqueOrThrow.mockRejectedValue(new Error("No record found"));

      await expect(repo.incrementFailure("missing")).rejects.toThrow("No record found");
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utility is below 0.2 and it has been used 5+ times", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utility is exactly at the 0.2 boundary", async () => {
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.2, successCount: 2, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when total uses are below the 5-use threshold", async () => {
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.05, successCount: 1, failureCount: 3 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("archives exactly at the 5-use boundary with low utility", async () => {
      prisma.agentSkill.update.mockResolvedValue(makeSkill());
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.05, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive a skill with high utility regardless of use count", async () => {
      const skill = makeSkill({ id: "skill-1", utilityScore: 0.9, successCount: 10, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility skill and creates the new one inside a transaction", async () => {
      const lowest = makeSkill({ id: "old-skill", utilityScore: 0.01 });
      prisma.agentSkill.findFirst.mockResolvedValue(lowest);
      const created = makeSkill({ id: "new-skill" });
      prisma.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "n",
        description: "d",
        taskCategory: "c",
        skillMarkdown: "m",
      });

      expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "old-skill" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.agentSkill.create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "n",
          description: "d",
          taskCategory: "c",
          skillMarkdown: "m",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "old-skill" });
    });

    it("throws without archiving or creating when there are no active skills to displace", async () => {
      prisma.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "n",
          description: "d",
          taskCategory: "c",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
      expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
