import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentSkillRepository,
  mapAgentSkillToDocument,
  type AgentSkill,
} from "../../src/orchestrator/agentSkillRepository.js";

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "retry-flaky-tests",
    description: "Retries flaky integration tests",
    taskCategory: "testing",
    skillMarkdown: "## Retry flaky tests\nUse exponential backoff.",
    utilityScore: 0.5,
    successCount: 2,
    failureCount: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: null,
    archivedAt: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(overrides as any),
  } as AgentSkill;
}

describe("mapAgentSkillToDocument", () => {
  it("projects only the document fields from a skill row", () => {
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
  let prisma: {
    agentSkill: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let repo: AgentSkillRepository;

  beforeEach(() => {
    const agentSkill = {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    };
    prisma = {
      agentSkill,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn((cb: (tx: any) => unknown) => cb({ agentSkill })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repo = new AgentSkillRepository(prisma as any);
  });

  it("create persists defaults for a new skill (score/counts start at zero)", async () => {
    prisma.agentSkill.create.mockResolvedValue(makeSkill({ utilityScore: 0 }));

    await repo.create({
      repoSlug: "org/repo",
      name: "retry-flaky-tests",
      description: "desc",
      taskCategory: "testing",
      skillMarkdown: "md",
    });

    expect(prisma.agentSkill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ utilityScore: 0.0, successCount: 0, failureCount: 0 }),
    });
  });

  it("findById returns null when missing", async () => {
    prisma.agentSkill.findUnique.mockResolvedValue(null);

    expect(await repo.findById("missing")).toBeNull();
  });

  it("findByRepoCategoryNearTime queries a time window around the given instant", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());
    const around = new Date("2026-01-01T00:00:10Z");

    await repo.findByRepoCategoryNearTime("org/repo", "testing", around, 2000);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: {
        repoSlug: "org/repo",
        taskCategory: "testing",
        createdAt: {
          gte: new Date("2026-01-01T00:00:08Z"),
          lte: new Date("2026-01-01T00:00:12Z"),
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("findByRepoCategoryNearTime defaults the window to 5000ms", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(null);
    const around = new Date("2026-01-01T00:00:10Z");

    await repo.findByRepoCategoryNearTime("org/repo", "testing", around);

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date("2026-01-01T00:00:05Z"),
            lte: new Date("2026-01-01T00:00:15Z"),
          },
        }),
      }),
    );
  });

  it("findActiveByRepo filters out archived skills", async () => {
    prisma.agentSkill.findMany.mockResolvedValue([makeSkill()]);

    await repo.findActiveByRepo("org/repo");

    expect(prisma.agentSkill.findMany).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
  });

  it("countActiveByRepo counts only active skills", async () => {
    prisma.agentSkill.count.mockResolvedValue(4);

    const result = await repo.countActiveByRepo("org/repo");

    expect(prisma.agentSkill.count).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
    });
    expect(result).toBe(4);
  });

  it("findLowestUtilityActive orders by utilityScore then lastUsedAt ascending", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(makeSkill());

    await repo.findLowestUtilityActive("org/repo");

    expect(prisma.agentSkill.findFirst).toHaveBeenCalledWith({
      where: { repoSlug: "org/repo", archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
  });

  it("archiveById stamps archivedAt with the current time", async () => {
    prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));

    await repo.archiveById("skill-1");

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("findTopKByRelevance scores, sorts descending, and truncates to min(k, MAX_SKILLS_INJECTED)", async () => {
    const skills = [
      makeSkill({ id: "s1", name: "deploy-service", taskCategory: "deploy" }),
      makeSkill({ id: "s2", name: "write-unit-tests", taskCategory: "testing" }),
      makeSkill({ id: "s3", name: "fix-lint-errors", taskCategory: "testing" }),
    ];
    prisma.agentSkill.findMany.mockResolvedValue(skills);

    const result = await repo.findTopKByRelevance("org/repo", "testing unit tests", 10);

    // MAX_SKILLS_INJECTED defaults to 3, so even asking for k=10 caps at 3
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result.every((doc) => "skillMarkdown" in doc)).toBe(true);
  });

  it("findTopKByRelevance returns an empty list when there are no active skills", async () => {
    prisma.agentSkill.findMany.mockResolvedValue([]);

    const result = await repo.findTopKByRelevance("org/repo", "anything", 5);

    expect(result).toEqual([]);
  });

  it("incrementSuccess recomputes utilityScore and bumps successCount inside a transaction", async () => {
    prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(
      makeSkill({ successCount: 2, failureCount: 1 }),
    );
    prisma.agentSkill.update.mockResolvedValue(makeSkill({ successCount: 3 }));

    const result = await repo.incrementSuccess("skill-1");

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        successCount: 3,
        utilityScore: 3 / (3 + 1 + 1),
        lastUsedAt: expect.any(Date),
      },
    });
    expect(result.successCount).toBe(3);
  });

  it("incrementFailure recomputes utilityScore and bumps failureCount inside a transaction", async () => {
    prisma.agentSkill.findUniqueOrThrow.mockResolvedValue(
      makeSkill({ successCount: 2, failureCount: 1 }),
    );
    prisma.agentSkill.update.mockResolvedValue(makeSkill({ failureCount: 2 }));

    await repo.incrementFailure("skill-1");

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        failureCount: 2,
        utilityScore: 2 / (2 + 2 + 1),
        lastUsedAt: expect.any(Date),
      },
    });
  });

  it("archiveIfLowUtility archives when utility is below threshold and usage is sufficient", async () => {
    prisma.agentSkill.update.mockResolvedValue(makeSkill({ archivedAt: new Date() }));
    const lowUtilitySkill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 5 });

    await repo.archiveIfLowUtility(lowUtilitySkill);

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: lowUtilitySkill.id },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("archiveIfLowUtility does not archive when usage count is too low", async () => {
    const skill = makeSkill({ utilityScore: 0.1, successCount: 1, failureCount: 2 });

    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });

  it("archiveIfLowUtility does not archive when utility is at or above threshold", async () => {
    const skill = makeSkill({ utilityScore: 0.2, successCount: 3, failureCount: 3 });

    await repo.archiveIfLowUtility(skill);

    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });

  it("displaceAndCreate archives the lowest-utility skill and creates a replacement", async () => {
    const lowest = makeSkill({ id: "low-1", utilityScore: 0.05 });
    prisma.agentSkill.findFirst.mockResolvedValue(lowest);
    prisma.agentSkill.update.mockResolvedValue({ ...lowest, archivedAt: new Date() });
    const created = makeSkill({ id: "new-1", name: "new-skill" });
    prisma.agentSkill.create.mockResolvedValue(created);

    const result = await repo.displaceAndCreate("org/repo", {
      name: "new-skill",
      description: "desc",
      taskCategory: "testing",
      skillMarkdown: "md",
    });

    expect(prisma.agentSkill.update).toHaveBeenCalledWith({
      where: { id: "low-1" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(result).toEqual({ newSkill: created, displacedSkillId: "low-1" });
  });

  it("displaceAndCreate throws when there is no active skill to displace", async () => {
    prisma.agentSkill.findFirst.mockResolvedValue(null);

    await expect(
      repo.displaceAndCreate("org/repo", {
        name: "new-skill",
        description: "desc",
        taskCategory: "testing",
        skillMarkdown: "md",
      }),
    ).rejects.toThrow("No active skills found for repo org/repo to displace");
  });
});
