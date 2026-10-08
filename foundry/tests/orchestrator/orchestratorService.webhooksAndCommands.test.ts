import { describe, it, expect } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";
import type { LinearCommand } from "../../src/linear/linearCommandParser.js";
import type { Run } from "../../src/domain/types.js";
import {
  createHarness,
  makeExecutionReport,
  makePlan,
  makeRun,
  type Harness,
} from "./helpers/orchestratorHarness.js";

/** Make findActiveByIssueId return whatever run is currently in the store. */
function withActiveRun(h: Harness): void {
  h.runRepo.findActiveByIssueId.mockImplementation(async () =>
    h.store.run ? ({ ...h.store.run } as Run) : null,
  );
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it.each(["issue.created", "issue.updated", "something.else"])(
    "ignores %s events",
    async (action) => {
      const h = createHarness();
      await h.svc.handleLinearWebhook({ action, issueId: "LIN-1", command: { type: "ai-plan" } });

      expect(h.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
      expect(h.linearClient.getIssue).not.toHaveBeenCalled();
      expect(h.logger.info).toHaveBeenCalledWith(
        { action, issueId: "LIN-1" },
        "Handling Linear webhook",
      );
    },
  );

  it("ignores comment.command events that carry no parsed command", async () => {
    const h = createHarness();
    await h.svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(h.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("dispatches comment.command events to handleCommand", async () => {
    const h = createHarness({ run: null });
    const existing = makeRun({ state: RunState.Planning });
    h.runRepo.findActiveByIssueId.mockResolvedValue(existing);

    await h.svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-9",
      command: { type: "run-ai" },
    });

    expect(h.runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-9");
    expect(h.logger.info).toHaveBeenCalledWith(
      { issueId: "LIN-9", command: "run-ai" },
      "Processing command",
    );
    // Active run exists -> startRun short-circuits.
    expect(h.runRepo.create).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it.each(["ai-plan", "run-ai"] as const)("%s starts a new run for the issue", async (type) => {
    const h = createHarness({ run: null });

    await h.svc.handleCommand("LIN-1", { type });

    expect(h.runRepo.create).toHaveBeenCalledTimes(1);
    expect(h.store.run?.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("approve-plan approves the plan and executes through to ready-for-review", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [{ type: "Plan", version: 1, payloadJson: makePlan() }],
      config: { executionReport: makeExecutionReport(), prNumber: 7 },
    });
    withActiveRun(h);

    await h.svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(h.store.run?.approvedPlanVersion).toBe(1);
    expect(h.store.run?.prNumber).toBe(7);
    expect(h.store.run?.state).toBe(RunState.ReadyForHumanReview);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.PLAN_APPROVED,
      RunEvent.EXECUTION_STARTED,
      RunEvent.EXECUTION_FINISHED,
      RunEvent.REVIEW_APPROVED,
    ]);
    expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("reject-plan replans with the comment body as Linear-sourced feedback", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [{ type: "Plan", version: 1, payloadJson: makePlan() }],
    });
    withActiveRun(h);

    await h.svc.handleCommand("LIN-1", { type: "reject-plan", body: "Split into two PRs" });

    const rejection = h.artifactsOfType("RejectionContext")[0]?.payloadJson;
    expect(rejection).toEqual({
      planVersion: 1,
      feedback: "Split into two PRs",
      source: "linear",
      mode: "iterate",
    });
    expect(h.recordedEventTypes()[0]).toBe(RunEvent.PLAN_REJECTED);
    expect(h.store.run?.planVersion).toBe(2);
    expect(h.store.run?.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("re-review runs the code review for the active run", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AIReview, prNumber: 12 }),
      artifacts: [
        { type: "Plan", version: 1, payloadJson: makePlan() },
        { type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() },
      ],
    });
    withActiveRun(h);

    await h.svc.handleCommand("LIN-1", { type: "re-review" });

    expect(h.reviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(h.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 12);
    expect(h.store.run?.state).toBe(RunState.ReadyForHumanReview);
  });

  it("pause-ai blocks the active run on behalf of the user", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Implementing }) });
    withActiveRun(h);

    await h.svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(h.store.run?.state).toBe(RunState.AIBlocked);
    expect(h.recordedEvent(RunEvent.BLOCKED)).toEqual({
      runId: "run-1",
      eventType: RunEvent.BLOCKED,
      source: "user-command",
      payloadJson: { from: RunState.Implementing, to: RunState.AIBlocked },
    });
    // AIBlocked is not terminal -> no worktree cleanup.
    expect(h.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("resume-ai resets a blocked run to Todo", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.AIBlocked }) });
    withActiveRun(h);

    await h.svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(h.store.run?.state).toBe(RunState.Todo);
    expect(h.recordedEvent(RunEvent.RESET_TO_TODO)?.source).toBe("user-command");
  });

  it("pause-ai on a finished run is rejected by the state machine", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Done }) });
    withActiveRun(h);

    await expect(h.svc.handleCommand("LIN-1", { type: "pause-ai" })).rejects.toBeInstanceOf(
      StateTransitionError,
    );
    expect(h.store.run?.state).toBe(RunState.Done);
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });

  it.each([
    { type: "approve-plan" },
    { type: "reject-plan", body: "x" },
    { type: "re-review" },
    { type: "pause-ai" },
    { type: "resume-ai" },
  ] as LinearCommand[])("$type is a no-op when the issue has no active run", async (command) => {
    const h = createHarness();

    await h.svc.handleCommand("LIN-1", command);

    expect(h.runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
    expect(h.runRepo.findById).not.toHaveBeenCalled();
    expect(h.eventRepo.create).not.toHaveBeenCalled();
    expect(h.linearClient.postComment).not.toHaveBeenCalled();
  });

  it("logs and ignores unknown commands", async () => {
    const h = createHarness();
    const command: LinearCommand = { type: "unknown", raw: "/frobnicate" };

    await h.svc.handleCommand("LIN-1", command);

    expect(h.logger.warn).toHaveBeenCalledWith(
      { issueId: "LIN-1", command },
      "Unknown command received",
    );
    expect(h.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService accessors", () => {
  it("expose the injected repositories and clients", () => {
    const h = createHarness({ withSkillRepo: true });
    expect(h.svc.getRunRepo()).toBe(h.runRepo);
    expect(h.svc.getArtifactRepo()).toBe(h.artifactRepo);
    expect(h.svc.getEventRepo()).toBe(h.eventRepo);
    expect(h.svc.getAgentSkillRepo()).toBe(h.agentSkillRepo);
    expect(h.svc.getLinearClient()).toBe(h.linearClient);
  });

  it("returns undefined for the skill repo when none is configured", () => {
    const h = createHarness();
    expect(h.svc.getAgentSkillRepo()).toBeUndefined();
  });
});
