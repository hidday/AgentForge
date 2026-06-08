import type { PrismaClient } from "../generated/prisma/client.js";
import type { AgentSkillModel } from "../generated/prisma/models/AgentSkill.js";
import type { SkillDocument } from "../domain/types.js";
import { scoreSkillRelevance } from "../utils/similarity.js";
import { env } from "../config/env.js";

export type AgentSkill = AgentSkillModel;

function toSkillDocument(skill: AgentSkill): SkillDocument {
  return {
    id: skill.id,
    repoSlug: skill.repoSlug,
    name: skill.name,
    description: skill.description,
    taskCategory: skill.taskCategory,
    skillMarkdown: skill.skillMarkdown,
    utilityScore: skill.utilityScore,
    lastUsedAt: skill.lastUsedAt,
  };
}

export function mapAgentSkillToDocument(skill: AgentSkill): SkillDocument {
  return toSkillDocument(skill);
}

export class AgentSkillRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: {
    repoSlug: string;
    name: string;
    description: string;
    taskCategory: string;
    skillMarkdown: string;
  }): Promise<AgentSkill> {
    return this.prisma.agentSkill.create({
      data: {
        repoSlug: data.repoSlug,
        name: data.name,
        description: data.description,
        taskCategory: data.taskCategory,
        skillMarkdown: data.skillMarkdown,
        utilityScore: 0.0,
        successCount: 0,
        failureCount: 0,
      },
    });
  }

  async findById(id: string): Promise<AgentSkill | null> {
    return this.prisma.agentSkill.findUnique({ where: { id } });
  }

  /** Fallback for runs distilled before skillId was stored on SKILL_DISTILLATION events. */
  async findByRepoCategoryNearTime(
    repoSlug: string,
    taskCategory: string,
    around: Date,
    windowMs = 5000,
  ): Promise<AgentSkill | null> {
    const from = new Date(around.getTime() - windowMs);
    const to = new Date(around.getTime() + windowMs);
    return this.prisma.agentSkill.findFirst({
      where: {
        repoSlug,
        taskCategory,
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findActiveByRepo(repoSlug: string): Promise<AgentSkill[]> {
    return this.prisma.agentSkill.findMany({
      where: { repoSlug, archivedAt: null },
    });
  }

  async countActiveByRepo(repoSlug: string): Promise<number> {
    return this.prisma.agentSkill.count({
      where: { repoSlug, archivedAt: null },
    });
  }

  async findLowestUtilityActive(repoSlug: string): Promise<AgentSkill | null> {
    return this.prisma.agentSkill.findFirst({
      where: { repoSlug, archivedAt: null },
      orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
    });
  }

  async archiveById(id: string): Promise<void> {
    await this.prisma.agentSkill.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  async findTopKByRelevance(repoSlug: string, query: string, k: number): Promise<SkillDocument[]> {
    const activeSkills = await this.findActiveByRepo(repoSlug);
    const maxK = Math.min(k, env.MAX_SKILLS_INJECTED);

    const scored = activeSkills
      .map((skill) => ({
        skill,
        score: scoreSkillRelevance(
          {
            taskCategory: skill.taskCategory,
            skillMarkdown: skill.skillMarkdown,
            name: skill.name,
            description: skill.description,
          },
          query,
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxK);

    return scored.map(({ skill }) => toSkillDocument(skill));
  }

  async incrementSuccess(id: string): Promise<AgentSkill> {
    return this.prisma.$transaction(async (tx) => {
      const skill = await tx.agentSkill.findUniqueOrThrow({ where: { id } });
      const newSuccessCount = skill.successCount + 1;
      const newUtilityScore = newSuccessCount / (newSuccessCount + skill.failureCount + 1);
      return tx.agentSkill.update({
        where: { id },
        data: {
          successCount: newSuccessCount,
          utilityScore: newUtilityScore,
          lastUsedAt: new Date(),
        },
      });
    });
  }

  async incrementFailure(id: string): Promise<AgentSkill> {
    return this.prisma.$transaction(async (tx) => {
      const skill = await tx.agentSkill.findUniqueOrThrow({ where: { id } });
      const newFailureCount = skill.failureCount + 1;
      const newUtilityScore = skill.successCount / (skill.successCount + newFailureCount + 1);
      return tx.agentSkill.update({
        where: { id },
        data: {
          failureCount: newFailureCount,
          utilityScore: newUtilityScore,
          lastUsedAt: new Date(),
        },
      });
    });
  }

  async archiveIfLowUtility(skill: AgentSkill): Promise<void> {
    const totalUses = skill.successCount + skill.failureCount;
    if (skill.utilityScore < 0.2 && totalUses >= 5) {
      await this.archiveById(skill.id);
    }
  }

  async displaceAndCreate(
    repoSlug: string,
    newSkillData: {
      name: string;
      description: string;
      taskCategory: string;
      skillMarkdown: string;
    },
  ): Promise<{ newSkill: AgentSkill; displacedSkillId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const lowestUtility = await tx.agentSkill.findFirst({
        where: { repoSlug, archivedAt: null },
        orderBy: [{ utilityScore: "asc" }, { lastUsedAt: "asc" }],
      });

      if (!lowestUtility) {
        throw new Error(`No active skills found for repo ${repoSlug} to displace`);
      }

      await tx.agentSkill.update({
        where: { id: lowestUtility.id },
        data: { archivedAt: new Date() },
      });

      const newSkill = await tx.agentSkill.create({
        data: {
          repoSlug,
          name: newSkillData.name,
          description: newSkillData.description,
          taskCategory: newSkillData.taskCategory,
          skillMarkdown: newSkillData.skillMarkdown,
          utilityScore: 0.0,
          successCount: 0,
          failureCount: 0,
        },
      });

      return { newSkill, displacedSkillId: lowestUtility.id };
    });
  }
}
