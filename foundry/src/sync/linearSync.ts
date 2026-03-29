import { RunState } from "../domain/runState.js";
import type { Run } from "../domain/types.js";
import type { LinearClient } from "../linear/linearClient.js";
import type { Logger } from "../utils/logger.js";

const AI_LABEL_PREFIX = "ai:";

const STATE_LABEL_MAP: Record<RunState, { label: string; issueState: string }> = {
  [RunState.Todo]: { label: "ai:todo", issueState: "Todo" },
  [RunState.Planning]: { label: "ai:planning", issueState: "In Progress" },
  [RunState.PlanReview]: { label: "ai:plan-review", issueState: "In Progress" },
  [RunState.PlanRevision]: { label: "ai:plan-revision", issueState: "In Progress" },
  [RunState.AwaitingPlanApproval]: { label: "ai:awaiting-approval", issueState: "In Progress" },
  [RunState.Implementing]: { label: "ai:implementing", issueState: "In Progress" },
  [RunState.AIReview]: { label: "ai:code-review", issueState: "In Progress" },
  [RunState.AddressingReview]: { label: "ai:remediation", issueState: "In Progress" },
  [RunState.ReadyForHumanReview]: { label: "ai:ready-for-review", issueState: "In Review" },
  [RunState.Done]: { label: "ai:done", issueState: "Done" },
  [RunState.AIBlocked]: { label: "ai:blocked", issueState: "In Progress" },
  [RunState.HumanClarificationNeeded]: {
    label: "ai:needs-clarification",
    issueState: "In Progress",
  },
  [RunState.Failed]: { label: "ai:failed", issueState: "Cancelled" },
};

export function getLabelForState(state: RunState): { label: string; issueState: string } {
  return STATE_LABEL_MAP[state];
}

export class LinearSyncService {
  constructor(
    private readonly linearClient: LinearClient,
    private readonly logger: Logger,
  ) {}

  async syncState(run: Run): Promise<void> {
    const mapping = getLabelForState(run.state);

    const currentLabels = await this.linearClient.listLabels(run.linearIssueId);
    const staleAiLabels = currentLabels.filter(
      (l) => l.startsWith(AI_LABEL_PREFIX) && l !== mapping.label,
    );

    for (const stale of staleAiLabels) {
      await this.linearClient.removeLabel(run.linearIssueId, stale);
    }

    if (!currentLabels.includes(mapping.label)) {
      await this.linearClient.addLabel(run.linearIssueId, mapping.label);
    }

    await this.linearClient.updateIssueState(run.linearIssueId, mapping.issueState);

    this.logger.debug(
      {
        issueId: run.linearIssueId,
        state: run.state,
        label: mapping.label,
        issueState: mapping.issueState,
        removedLabels: staleAiLabels,
      },
      "Synced Linear state",
    );
  }
}
