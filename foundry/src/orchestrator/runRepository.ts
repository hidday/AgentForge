import type { PrismaClient } from "../generated/prisma/client.js";
import type { RunState as PrismaRunState } from "../generated/prisma/enums.js";
import { RunState } from "../domain/runState.js";
import type { Run } from "../domain/types.js";

const TERMINAL_STATES: RunState[] = [RunState.Done, RunState.Failed];

function toDomain(row: {
  id: string;
  linearIssueId: string;
  linearIssueIdentifier: string | null;
  linearIssueDescription: string | null;
  linearIssueTitle: string | null;
  linearIssueUrl: string | null;
  repo: string;
  branchName: string | null;
  prNumber: number | null;
  state: PrismaRunState;
  planVersion: number;
  approvedPlanVersion: number | null;
  plannerRuntime: string | null;
  executorRuntime: string | null;
  reviewerRuntime: string | null;
  remediationRuntime: string | null;
  workingDirectory: string;
  latestArtifactVersion: number;
  createdAt: Date;
  updatedAt: Date;
}): Run {
  return {
    ...row,
    state: row.state as RunState,
  };
}

export class RunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: {
    linearIssueId: string;
    linearIssueIdentifier?: string;
    linearIssueDescription?: string;
    linearIssueTitle?: string;
    linearIssueUrl?: string;
    repo: string;
    workingDirectory: string;
  }): Promise<Run> {
    const row = await this.prisma.aiRun.create({
      data: {
        linearIssueId: params.linearIssueId,
        linearIssueIdentifier: params.linearIssueIdentifier ?? null,
        linearIssueDescription: params.linearIssueDescription ?? null,
        linearIssueTitle: params.linearIssueTitle ?? null,
        linearIssueUrl: params.linearIssueUrl ?? null,
        repo: params.repo,
        workingDirectory: params.workingDirectory,
        state: "Todo",
      },
    });
    return toDomain(row);
  }

  async findAll(stateFilter?: string): Promise<Run[]> {
    let where: { state?: PrismaRunState | { in: PrismaRunState[] } } | undefined;
    if (stateFilter) {
      const states = stateFilter
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (states.length === 1) {
        where = { state: states[0] as PrismaRunState };
      } else if (states.length > 1) {
        where = { state: { in: states as PrismaRunState[] } };
      }
    }
    const rows = await this.prisma.aiRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDomain);
  }

  async findById(id: string): Promise<Run | null> {
    const row = await this.prisma.aiRun.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIssueId(linearIssueId: string): Promise<Run | null> {
    const row = await this.prisma.aiRun.findFirst({
      where: { linearIssueId },
      orderBy: { createdAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }

  async findActiveByIssueId(linearIssueId: string): Promise<Run | null> {
    const row = await this.prisma.aiRun.findFirst({
      where: {
        linearIssueId,
        state: { notIn: TERMINAL_STATES as PrismaRunState[] },
      },
      orderBy: { createdAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }

  async updateState(id: string, state: RunState): Promise<Run> {
    const row = await this.prisma.aiRun.update({
      where: { id },
      data: { state: state as PrismaRunState },
    });
    return toDomain(row);
  }

  /** Runs missing title and/or issue-body snapshot; safe to backfill from Linear. */
  async findRunsNeedingLinearBackfill(): Promise<Run[]> {
    const rows = await this.prisma.aiRun.findMany({
      where: {
        OR: [{ linearIssueTitle: null }, { linearIssueDescription: null }],
      },
    });
    return rows.map(toDomain);
  }

  async update(
    id: string,
    data: Partial<
      Pick<
        Run,
        | "linearIssueIdentifier"
        | "linearIssueDescription"
        | "linearIssueTitle"
        | "linearIssueUrl"
        | "branchName"
        | "prNumber"
        | "planVersion"
        | "approvedPlanVersion"
        | "plannerRuntime"
        | "executorRuntime"
        | "reviewerRuntime"
        | "remediationRuntime"
        | "workingDirectory"
        | "latestArtifactVersion"
      >
    >,
  ): Promise<Run> {
    const row = await this.prisma.aiRun.update({
      where: { id },
      data,
    });
    return toDomain(row);
  }
}
