import { describe, it, expect, vi } from "vitest";
import { AgentSkillRepository, mapAgentSkillToDocument } from "../../src/orchestrator/agentSkillRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    repoSlug: "org/repo",
    name: "name",
    description: "description",
    taskCategory: "category",
    skillMarkdown: "# markdown",
    utilityScore: 0,
    successCount: 0,
    failureCount: 0,
    lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makePrisma(overrides: {
  create?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
  findFirst?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  count?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  findUniqueOrThrow?: ReturnType<typeof vi.fn>;
  $transaction?: ReturnType<typeof vi.fn>;
}) {
  const agentSkill = {
    create: overrides.create ?? vi.fn(),
    findUnique: overrides.findUnique ?? vi.fn(),
    findFirst: overrides.findFirst ?? vi.fn(),
    findMany: overrides.findMany ?? vi.fn(),
    count: overrides.count ?? vi.fn(),
    update: overrides.update ?? vi.fn(),
    findUniqueOrThrow: overrides.findUniqueOrThrow ?? vi.fn(),
  };
  const $transaction =
    overrides.$transaction ??
    vi.fn(async (cb: (tx: { agentSkill: typeof agentSkill }) => unknown) => cb({ agentSkill }));
  return {
    agentSkill,
    $transaction,
  } as unknown as PrismaClient;
}

describe("mapAgentSkillToDocument", () => {
  it("maps an AgentSkill row to a SkillDocument with the same field values", () => {
    const skill = makeSkill({
      id: "skill-x",
      repoSlug: "org/repo-x",
      name: "my-name",
      description: "my-desc",
      taskCategory: "cat-x",
      skillMarkdown: "md",
      utilityScore: 0.42,
      lastUsedAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    const doc = mapAgentSkillToDocument(skill as never);

    expect(doc).toEqual({
      id: "skill-x",
      repoSlug: "org/repo-x",
      name: "my-name",
      description: "my-desc",
      taskCategory: "cat-x",
      skillMarkdown: "md",
      utilityScore: 0.42,
      lastUsedAt: skill.lastUsedAt,
    });
  });
});

describe("AgentSkillRepository", () => {
  describe("create", () => {
    it("creates a skill with zeroed utilityScore/successCount/failureCount", async () => {
      const row = makeSkill();
      const create = vi.fn().mockResolvedValue(row);
      const repo = new AgentSkillRepository(makePrisma({ create }));

      const result = await repo.create({
        repoSlug: "org/repo",
        name: "name",
        description: "description",
        taskCategory: "category",
        skillMarkdown: "# markdown",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "name",
          description: "description",
          taskCategory: "category",
          skillMarkdown: "# markdown",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toBe(row);
    });
  });

  describe("findById", () => {
    it("queries by id and returns the row", async () => {
      const row = makeSkill();
      const findUnique = vi.fn().mockResolvedValue(row);
      const repo = new AgentSkillRepository(makePrisma({ findUnique }));

      const result = await repo.findById("skill-1");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      expect(result).toBe(row);
    });

    it("returns null when no skill matches the id", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const repo = new AgentSkillRepository(makePrisma({ findUnique }));

      const result = await repo.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByRepoCategoryNearTime", () => {
    it("queries with a time window derived from the given windowMs, ordered by createdAt desc", async () => {
      const around = new Date("2026-04-01T12:00:00.000Z");
      const row = makeSkill();
      const findFirst = vi.fn().mockResolvedValue(row);
      const repo = new AgentSkillRepository(makePrisma({ findFirst }));

      const result = await repo.findByRepoCategoryNearTime("org/repo", "category", around, 2000);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "category",
          createdAt: {
            gte: new Date(around.getTime() - 2000),
            lte: new Date(around.getTime() + 2000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(row);
    });

    it("defaults windowMs to 5000 when not provided", async () => {
      const around = new Date("2026-04-01T12:00:00.000Z");
      const findFirst = vi.fn().mockResolvedValue(null);
      const repo = new AgentSkillRepository(makePrisma({ findFirst }));

      await repo.findByRepoCategoryNearTime("org/repo", "category", around);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          repoSlug: "org/repo",
          taskCategory: "category",
          createdAt: {
            gte: new Date(around.getTime() - 5000),
            lte: new Date(around.getTime() + 5000),
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns null when nothing falls within the time window", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const repo = new AgentSkillRepository(makePrisma({ findFirst }));

      const result = await repo.findByRepoCategoryNearTime("org/repo", "category", new Date());

      expect(result).toBeNull();
    });
  });

  describe("findActiveByRepo", () => {
    it("queries active (non-archived) skills for the repo", async () => {
      const rows = [makeSkill()];
      const findMany = vi.fn().mockResolvedValue(rows);
      const repo = new AgentSkillRepository(makePrisma({ findMany }));

      const result = await repo.findActiveByRepo("org/repo");

      expect(findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(rows);
    });

    it("returns an empty array when the repo has no active skills", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repo = new AgentSkillRepository(makePrisma({ findMany }));

      const result = await repo.findActiveByRepo("org/repo");

      expect(result).toEqual([]);
    });
  });

  describe("countActiveByRepo", () => {
    it("counts active (non-archived) skills for the repo", async () => {
      const count = vi.fn().mockResolvedValue(7);
      const repo = new AgentSkillRepository(makePrisma({ count }));

      const result = await repo.countActiveByRepo("org/repo");

      expect(count).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toBe(7);
    });

    it("returns 0 when there are no active skills", async () => {
      const count = vi.fn().mockResolvedValue(0);
      const repo = new AgentSkillRepository(makePrisma({ count }));

      const result = await repo.countActiveByRepo("org/repo");

      expect(result).toBe(0);
    });
  });

  describe("findLowestUtilityActive", () => {
    it("orders by utilityScore asc then lastUsedAt asc, filtered to active skills", async () => {
      const row = makeSkill({ utilityScore: 0.1 });
      const findFirst = vi.fn().mockResolvedValue(row);
      const repo = new AgentSkillRepository(makePrisma({ findFirst }));

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(result).toBe(row);
    });

    it("returns null when there are no active skills to pick from", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const repo = new AgentSkillRepository(makePrisma({ findFirst }));

      const result = await repo.findLowestUtilityActive("org/repo");

      expect(result).toBeNull();
    });
  });

  describe("archiveById", () => {
    it("sets archivedAt to the current time for the given id", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(makePrisma({ update }));

      const before = Date.now();
      await repo.archiveById("skill-1");
      const after = Date.now();

      expect(update).toHaveBeenCalledTimes(1);
      const call = update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "skill-1" });
      expect(call.data.archivedAt).toBeInstanceOf(Date);
      const archivedAtMs = call.data.archivedAt.getTime();
      expect(archivedAtMs).toBeGreaterThanOrEqual(before);
      expect(archivedAtMs).toBeLessThanOrEqual(after);
    });
  });

  describe("findTopKByRelevance", () => {
    it("scores active skills by relevance, sorts descending, and maps to SkillDocuments", async () => {
      // Query shares trigrams with "billing refunds" much more than with "auth login".
      const billing = makeSkill({
        id: "skill-billing",
        taskCategory: "billing refunds",
        skillMarkdown: "handles billing refund workflows",
        name: "billing-refunds",
        description: "billing refunds",
      });
      const auth = makeSkill({
        id: "skill-auth",
        taskCategory: "auth login",
        skillMarkdown: "handles auth login flows",
        name: "auth-login",
        description: "auth login",
      });
      const findMany = vi.fn().mockResolvedValue([auth, billing]);
      const repo = new AgentSkillRepository(makePrisma({ findMany }));

      const result = await repo.findTopKByRelevance("org/repo", "billing refunds", 2);

      expect(findMany).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
      });
      expect(result).toHaveLength(2);
      // The more relevant skill (billing) must be ranked first despite being second in input order.
      expect(result[0].id).toBe("skill-billing");
      expect(result[1].id).toBe("skill-auth");
    });

    it("caps the returned count at env.MAX_SKILLS_INJECTED even when k is larger", async () => {
      const skills = [
        makeSkill({ id: "s1", taskCategory: "cat-one" }),
        makeSkill({ id: "s2", taskCategory: "cat-two" }),
        makeSkill({ id: "s3", taskCategory: "cat-three" }),
        makeSkill({ id: "s4", taskCategory: "cat-four" }),
        makeSkill({ id: "s5", taskCategory: "cat-five" }),
      ];
      const findMany = vi.fn().mockResolvedValue(skills);
      const repo = new AgentSkillRepository(makePrisma({ findMany }));

      // k=10 requested, but env.MAX_SKILLS_INJECTED defaults to 3.
      const result = await repo.findTopKByRelevance("org/repo", "cat-one", 10);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("respects k when k is smaller than env.MAX_SKILLS_INJECTED", async () => {
      const skills = [
        makeSkill({ id: "s1", taskCategory: "cat-one" }),
        makeSkill({ id: "s2", taskCategory: "cat-two" }),
        makeSkill({ id: "s3", taskCategory: "cat-three" }),
      ];
      const findMany = vi.fn().mockResolvedValue(skills);
      const repo = new AgentSkillRepository(makePrisma({ findMany }));

      const result = await repo.findTopKByRelevance("org/repo", "cat-one", 1);

      expect(result).toHaveLength(1);
    });

    it("returns an empty array when there are no active skills", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repo = new AgentSkillRepository(makePrisma({ findMany }));

      const result = await repo.findTopKByRelevance("org/repo", "anything", 5);

      expect(result).toEqual([]);
    });
  });

  describe("incrementSuccess", () => {
    it("increments successCount, recomputes utilityScore, and touches lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 2, failureCount: 1 });
      const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
      const update = vi.fn().mockImplementation(({ data }) => ({ ...existing, ...data }));
      const repo = new AgentSkillRepository(makePrisma({ findUniqueOrThrow, update }));

      const result = await repo.incrementSuccess("skill-1");

      expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "skill-1" } });
      // newSuccessCount = 3; utilityScore = 3 / (3 + 1 + 1) = 0.6
      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          successCount: 3,
          utilityScore: 0.6,
        }),
      });
      expect(update.mock.calls[0][0].data.lastUsedAt).toBeInstanceOf(Date);
      expect(result.successCount).toBe(3);
      expect(result.utilityScore).toBe(0.6);
    });

    it("propagates the error when the skill does not exist", async () => {
      const findUniqueOrThrow = vi.fn().mockRejectedValue(new Error("No AgentSkill found"));
      const repo = new AgentSkillRepository(makePrisma({ findUniqueOrThrow }));

      await expect(repo.incrementSuccess("missing")).rejects.toThrow("No AgentSkill found");
    });
  });

  describe("incrementFailure", () => {
    it("increments failureCount, recomputes utilityScore, and touches lastUsedAt inside a transaction", async () => {
      const existing = makeSkill({ id: "skill-1", successCount: 3, failureCount: 1 });
      const findUniqueOrThrow = vi.fn().mockResolvedValue(existing);
      const update = vi.fn().mockImplementation(({ data }) => ({ ...existing, ...data }));
      const repo = new AgentSkillRepository(makePrisma({ findUniqueOrThrow, update }));

      const result = await repo.incrementFailure("skill-1");

      // newFailureCount = 2; utilityScore = 3 / (3 + 2 + 1) = 0.5
      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-1" },
        data: expect.objectContaining({
          failureCount: 2,
          utilityScore: 0.5,
        }),
      });
      expect(result.failureCount).toBe(2);
      expect(result.utilityScore).toBe(0.5);
    });

    it("propagates the error when the skill does not exist", async () => {
      const findUniqueOrThrow = vi.fn().mockRejectedValue(new Error("No AgentSkill found"));
      const repo = new AgentSkillRepository(makePrisma({ findUniqueOrThrow }));

      await expect(repo.incrementFailure("missing")).rejects.toThrow("No AgentSkill found");
    });
  });

  describe("archiveIfLowUtility", () => {
    it("archives the skill when utilityScore < 0.2 and totalUses >= 5", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(makePrisma({ update }));
      const skill = makeSkill({ id: "skill-low", utilityScore: 0.1, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill as never);

      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-low" },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it("does not archive when utilityScore is at or above the 0.2 threshold", async () => {
      const update = vi.fn();
      const repo = new AgentSkillRepository(makePrisma({ update }));
      const skill = makeSkill({ id: "skill-ok", utilityScore: 0.2, successCount: 1, failureCount: 4 });

      await repo.archiveIfLowUtility(skill as never);

      expect(update).not.toHaveBeenCalled();
    });

    it("does not archive when totalUses is below 5, even with a low utilityScore", async () => {
      const update = vi.fn();
      const repo = new AgentSkillRepository(makePrisma({ update }));
      const skill = makeSkill({ id: "skill-new", utilityScore: 0.05, successCount: 1, failureCount: 2 });

      await repo.archiveIfLowUtility(skill as never);

      expect(update).not.toHaveBeenCalled();
    });

    it("archives exactly at the totalUses boundary of 5", async () => {
      const update = vi.fn().mockResolvedValue(makeSkill());
      const repo = new AgentSkillRepository(makePrisma({ update }));
      const skill = makeSkill({ id: "skill-boundary", utilityScore: 0.19, successCount: 2, failureCount: 3 });

      await repo.archiveIfLowUtility(skill as never);

      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-boundary" },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("displaceAndCreate", () => {
    it("archives the lowest-utility active skill and creates the new skill inside a transaction", async () => {
      const lowest = makeSkill({ id: "skill-lowest", utilityScore: 0.05 });
      const created = makeSkill({ id: "skill-new", utilityScore: 0 });
      const findFirst = vi.fn().mockResolvedValue(lowest);
      const update = vi.fn().mockResolvedValue({ ...lowest, archivedAt: new Date() });
      const create = vi.fn().mockResolvedValue(created);
      const repo = new AgentSkillRepository(makePrisma({ findFirst, update, create }));

      const result = await repo.displaceAndCreate("org/repo", {
        name: "new-name",
        description: "new-desc",
        taskCategory: "new-cat",
        skillMarkdown: "new markdown",
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: { repoSlug: "org/repo", archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: "skill-lowest" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          repoSlug: "org/repo",
          name: "new-name",
          description: "new-desc",
          taskCategory: "new-cat",
          skillMarkdown: "new markdown",
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });
      expect(result).toEqual({ newSkill: created, displacedSkillId: "skill-lowest" });
    });

    it("throws when there are no active skills to displace", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const repo = new AgentSkillRepository(makePrisma({ findFirst }));

      await expect(
        repo.displaceAndCreate("org/repo-empty", {
          name: "n",
          description: "d",
          taskCategory: "t",
          skillMarkdown: "m",
        }),
      ).rejects.toThrow("No active skills found for repo org/repo-empty to displace");
    });
  });
});
