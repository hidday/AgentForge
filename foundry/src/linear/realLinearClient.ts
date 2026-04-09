import { LinearClient as LinearSdk } from "@linear/sdk";
import type { LinearClient, LinearIssue, IssueSearchFilter } from "./linearClient.js";
import type { Logger } from "../utils/logger.js";

export class RealLinearClient implements LinearClient {
  private readonly sdk: LinearSdk;
  private readonly logger: Logger;
  private readonly labelCache = new Map<string, string>();
  private readonly stateCache = new Map<string, Map<string, string>>();

  constructor(apiKey: string, logger: Logger) {
    this.sdk = new LinearSdk({ apiKey });
    this.logger = logger;
  }

  async getIssue(issueId: string): Promise<LinearIssue> {
    const issue = await this.sdk.issue(issueId);

    const labelsConn = await issue.labels();
    const labels = labelsConn?.nodes?.map((l) => l.name) ?? [];

    const state = await issue.state;
    const project = await issue.project;
    const cycle = await issue.cycle;
    const team = await issue.team;

    return {
      id: issue.id,
      title: issue.title,
      description: issue.description ?? "",
      state: state?.name ?? "Unknown",
      labels,
      priority: issue.priority,
      project: project?.name ?? undefined,
      team: team?.key ?? undefined,
      cycle: cycle?.name ?? undefined,
    };
  }

  async searchIssues(filter: IssueSearchFilter): Promise<LinearIssue[]> {
    const { projectName, assigneeMe, team, state: stateName } = filter;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gqlFilter: Record<string, any> = {
      state: { name: { eq: stateName } },
    };

    if (projectName) {
      gqlFilter["project"] = { name: { eq: projectName } };
    }

    if (assigneeMe) {
      gqlFilter["assignee"] = { isMe: { eq: true } };
    }

    if (team) {
      gqlFilter["team"] = { or: [{ name: { eq: team } }, { key: { eq: team } }] };
    }

    const issuesConn = await this.sdk.issues({ filter: gqlFilter });

    const results: LinearIssue[] = [];
    for (const issue of issuesConn?.nodes ?? []) {
      const labelsConn = await issue.labels();
      const labels = labelsConn?.nodes?.map((l) => l.name) ?? [];
      const project = await issue.project;
      const cycle = await issue.cycle;

      const team = await issue.team;

      results.push({
        id: issue.id,
        title: issue.title,
        description: issue.description ?? "",
        state: stateName,
        labels,
        priority: issue.priority,
        project: project?.name ?? undefined,
        team: team?.key ?? undefined,
        cycle: cycle?.name ?? undefined,
      });
    }

    this.logger.info(
      { projectName, assigneeMe, team, stateName, count: results.length },
      "Searched Linear issues",
    );
    return results;
  }

  async postComment(issueId: string, body: string): Promise<void> {
    await this.sdk.createComment({ issueId, body });
    this.logger.debug({ issueId }, "Posted comment to Linear issue");
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    const issue = await this.sdk.issue(issueId);
    const team = await issue.team;
    if (!team) {
      this.logger.warn({ issueId }, "Cannot update state: issue has no team");
      return;
    }

    const stateId = await this.resolveStateId(team.id, stateName);
    if (!stateId) {
      this.logger.warn(
        { issueId, stateName, teamId: team.id },
        "Could not find workflow state by name",
      );
      return;
    }

    await this.sdk.updateIssue(issueId, { stateId });
    this.logger.debug({ issueId, stateName, stateId }, "Updated Linear issue state");
  }

  async addLabel(issueId: string, labelName: string): Promise<void> {
    const issue = await this.sdk.issue(issueId);
    const team = await issue.team;

    const labelId = await this.resolveOrCreateLabel(labelName, team?.id);
    const currentIds = [...issue.labelIds];

    if (!currentIds.includes(labelId)) {
      currentIds.push(labelId);
      await this.sdk.updateIssue(issueId, { labelIds: currentIds });
    }

    this.logger.debug({ issueId, labelName, labelId }, "Added label to Linear issue");
  }

  async removeLabel(issueId: string, labelName: string): Promise<void> {
    const issue = await this.sdk.issue(issueId);
    const labelId = this.labelCache.get(labelName);

    if (!labelId) {
      const labelsConn = await issue.labels();
      const match = labelsConn?.nodes?.find((l) => l.name === labelName);
      if (!match) return;
      this.labelCache.set(labelName, match.id);
      const filtered = issue.labelIds.filter((id) => id !== match.id);
      await this.sdk.updateIssue(issueId, { labelIds: filtered });
    } else {
      const filtered = issue.labelIds.filter((id) => id !== labelId);
      await this.sdk.updateIssue(issueId, { labelIds: filtered });
    }

    this.logger.debug({ issueId, labelName }, "Removed label from Linear issue");
  }

  async listLabels(issueId: string): Promise<string[]> {
    const issue = await this.sdk.issue(issueId);
    const labelsConn = await issue.labels();
    const names = labelsConn?.nodes?.map((l) => l.name) ?? [];

    for (const node of labelsConn?.nodes ?? []) {
      this.labelCache.set(node.name, node.id);
    }

    return names;
  }

  private async resolveStateId(teamId: string, stateName: string): Promise<string | undefined> {
    let stateMap = this.stateCache.get(teamId);
    if (!stateMap) {
      stateMap = new Map();
      const team = await this.sdk.team(teamId);
      const statesConn = await team.states();
      for (const state of statesConn?.nodes ?? []) {
        stateMap.set(state.name, state.id);
      }
      this.stateCache.set(teamId, stateMap);
    }
    return stateMap.get(stateName);
  }

  private async resolveOrCreateLabel(labelName: string, teamId?: string): Promise<string> {
    const cached = this.labelCache.get(labelName);
    if (cached) return cached;

    const existing = await this.sdk.issueLabels({
      filter: { name: { eq: labelName } },
    });
    const match = existing?.nodes?.[0];
    if (match) {
      this.labelCache.set(labelName, match.id);
      return match.id;
    }

    const payload = await this.sdk.createIssueLabel({
      name: labelName,
      ...(teamId ? { teamId } : {}),
    });
    const created = await payload.issueLabel;
    if (!created) {
      throw new Error(`Failed to create label: ${labelName}`);
    }
    this.labelCache.set(labelName, created.id);
    this.logger.info({ labelName, labelId: created.id }, "Created new Linear label");
    return created.id;
  }
}
