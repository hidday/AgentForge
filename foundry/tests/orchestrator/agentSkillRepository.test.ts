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
    repoSlug: "org/repo",
    name: "deploy-helper",
    description: "Helps deploy things",
    taskCategory: "deployment",
    skillMarkdown: "# Deploy helper\nSteps to deploy safely.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    archivedAt: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    lastUsedAt: new Date("2024-01-02T00:00:00Z"),
    ...overrides,
  } as unknown as AgentSkill;
}

function makeTx() {
  return {
    agentSkill: {
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };
}

function makePrisma() {
  const tx = makeTx();
  const prisma = {
    agentSkill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(tx)),
  };
  return { prisma: prisma as unknown as PrismaClient, tx };
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to the public SkillDocument shape", () => {
    const skill = makeSkill();
    const doc = mapAgentSkillToDocument(skill);
    expect(doc).toEqual({
      id: "skill-1",
      repoSlug: "org/repo",
      name: "deploy-helper",
      description: "Helps deploy things",
      taskCategory: "deployment",
      skillMarkdown: skill.skillMarkdown,
      utilityScore: 0.5,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  let prisma: ReturnType<typeof makePrisma>["prisma"];
  let tx: ReturnType<typeof makeTx>;
  let repo: AgentSkillRepository;

  beforeEach(() => {
    const made = makePrisma();
    prisma = made.prisma;
    tx = made.tx;
    repo = new AgentSkillRepository(prisma);
  });

  it("create() persists with zeroed counters and utility score", async () => {
    (prisma.agentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());

    await repo.create({
      repoSlug: "org/repo",
      name: "deploy-helper",
      description: "desc",
      taskCategory: "deployment",
      skillMarkdown: "# md",
    });

    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        repoSlug: "org/repo",
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      }),
    });
  });

  it("findById() returns null when not found", async () => {
    (prisma.agentSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await repo.findById("missing");
    expect(result).toBeNull();
  });

  it("findByRepoCategoryNearTime() queries within a +/- windowMs range around the given time", async () => {
    (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
    const around = new Date("2024-06-01T12:00:00Z");

    await repo.findByRepoCategoryNearTime("org/repo", "deployment", around, 2000);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "org/repo",
        taskCategory: "deployment",
        createdAt: {
          gte: new Date("2024-06-01T11:59:58Z"),
          lte: new Date("2024-06-01T12:00:02Z"),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findByRepoCategoryNearTime() defaults the window to 5000ms", async () => {
    (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const around = new Date("2024-06-01T12:00:00Z");

    await repo.findByRepoCategoryNearTime("org/repo", "deployment", around);

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
  });

  it("findActiveByRepo() filters to non-archived skills for the repo", async () => {
    (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeSkill()]);
    const result = await repo.findActiveByRepo("org/repo");
    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
    expect(result).toHaveLength(1);
  });

  it("countActiveByRepo() counts non-archived skills for the repo", async () => {
    (prisma.agentSkill.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    const result = await repo.countActiveByRepo("org/repo");
    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
    expect(result).toBe(3);
  });

  it("findLowestUtilityActive() orders by utilityScore asc then lastUsedAt asc", async () => {
    (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
    await repo.findLowestUtilityActive("org/repo");
    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
  });

  it("findLowestUtilityActive() returns null when there are no active skills", async () => {
    (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await repo.findLowestUtilityActive("org/repo");
    expect(result).toBeNull();
  });

  it("archiveById() sets archivedAt to a Date", async () => {
    (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
    await repo.archiveById("skill-1");
    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  describe("findTopKByRelevance", () => {
    it("ranks active skills by relevance and returns up to k mapped documents", async () => {
      const relevant = makeSkill({
        id: "relevant",
        taskCategory: "deployment",
        skillMarkdown: "# Deploy helper\nSteps to deploy safely to production.",
      });
      const irrelevant = makeSkill({
        id: "irrelevant",
        name: "billing-helper",
        description: "Handles invoices and payments",
        taskCategory: "billing",
        skillMarkdown: "# Billing\nHandles invoices and payments.",
      });
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        irrelevant,
        relevant,
      ]);

      const result = await repo.findTopKByRelevance("org/repo", "deploy safely to production", 5);

      expect(result[0].id).toBe("relevant");
    });

    it("caps k at env.MAX_SKILLS_INJECTED even when a larger k is requested", async () => {
      const skills = [
        makeSkill({ id: "s1" }),
        makeSkill({ id: "s2" }),
        makeSkill({ id: "s3" }),
        makeSkill({ id: "s4" }),
        makeSkill({ id: "s5" }),
      ];
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(skills);

      // MAX_SKILLS_INJECTED defaults to 3; requesting 10 should still cap at 3.
      const result = await repo.findTopKByRelevance("org/repo", "deployment", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns an empty array when there are no active skills", async () => {
      (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await repo.findTopKByRelevance("org/repo", "anything", 5);
      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("recomputes utilityScore as newSuccessCount / (newSuccessCount + failureCount + 1)", async () => {
      const current = makeSkill({ successCount: 2, failureCount: 1 });
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(current);
      tx.agentSkill.update.mockResolvedValue({ ...current, successCount: 3 });

      await repo.incrementSuccess("skill-1");

      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          successCount: 3,
          utilityScore: 3 / (3 + 1 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
    });
  });

  describe("incrementFailure", () => {
    it("recomputes utilityScore as successCount / (successCount + newFailureCount + 1)", async () => {
      const current = makeSkill({ successCount: 2, failureCount: 1 });
      tx.agentSkill.findUniqueOrThrow.mockResolvedValue(current);
      tx.agentSkill.update.mockResolvedValue({ ...current, failureCount: 2 });

      await repo.incrementFailure("skill-1");

      expect(tx.agentSkill.update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: {
          failureCount: 2,
          utilityScore: 2 / (2 + 2 + 1),
          lastUsedAt: expect.any(Date),
        },
      });
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives when utilityScore < 0.2 and total uses >= 5", async () => {
      (prisma.agentSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeSkill());
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).toHaveBeenCalledWith({
        where: { id: skill.id },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is low but total uses < 5", async () => {
      const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 1 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });

    it("does not archive when utilityScore is at or above 0.2 even with many uses", async () => {
      const skill = makeSkill({ utilityScore: 0.2, successCount: 5, failureCount: 5 });

      await repo.archiveIfLowUtility(skill);

      expect(prisma.agentSkill.update).not.toHaveBeenCalled();
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new one in the same transaction", async () => {
      const lowest = makeSkill({ id: "lowest", utilityScore: 0.05 });
      const created = makeSkill({ id: "new-skill", utilityScore: 0 });
      tx.agentSkill.findFirst.mockResolvedValue(lowest);
      tx.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
      tx.agentSkill.create.mockResolvedValue(created);

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "deployment",
        skillMarkdown: "# md",
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
        data: expect.objectContaining({ repoSlug: "org/repo", name: "new-skill" }),
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "lowest" });
    });

    it("throws when there is no active skill to displace", async () => {
      tx.agentSkill.findFirst.mockResolvedValue(null);

      await expect(
        repo.displaceAndCreate("org/repo", {
          name: "new-skill",
          description: "desc",
          taskCategory: "deployment",
          skillMarkdown: "# md",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo to displace");

      expect(tx.agentSkill.create).not.toHaveBeenCalled();
    });
  });
});
