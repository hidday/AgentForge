import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildDeps,
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
} from "./orchestratorServiceTestHelpers.js";

describe("OrchestratorService buildTaskBundle (via startRun)", () => {
  it("prefers the remote default branch over config when they differ", async () => {
    const { deps, githubClient } = buildDeps();
    githubClient.getDefaultBranch.mockResolvedValue("develop");
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(githubClient.getDefaultBranch).toHaveBeenCalledWith("test-repo");
  });

  it("falls back to the configured default branch when GitHub lookup fails", async () => {
    const { deps, githubClient, logger } = buildDeps();
    githubClient.getDefaultBranch.mockRejectedValue(new Error("github down"));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await expect(svc.startRun("LIN-1")).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo" }),
      expect.stringContaining("falling back to config value"),
    );
  });

  it("includes relatedContext when the issue has a parent or blockers", async () => {
    const { deps, linearClient, plannerAgent } = buildDeps();
    linearClient.getRelatedContext.mockResolvedValue({
      parent: {
        id: "LIN-0",
        title: "Parent",
        description: "d",
        state: "Todo",
        labels: [],
        priority: 1,
      },
      blockers: [],
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedContext: expect.objectContaining({ parent: expect.anything() }),
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("omits relatedContext when there is no parent and no blockers", async () => {
    const { deps, linearClient, plannerAgent } = buildDeps();
    linearClient.getRelatedContext.mockResolvedValue({ blockers: [] });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.not.objectContaining({ relatedContext: expect.anything() }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("proceeds without relatedContext when the Linear lookup fails", async () => {
    const { deps, linearClient, logger } = buildDeps();
    linearClient.getRelatedContext.mockRejectedValue(new Error("linear down"));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await expect(svc.startRun("LIN-1")).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      expect.stringContaining("Failed to fetch related Linear context"),
    );
  });
});

describe("OrchestratorService worktree cleanup on terminal transitions", () => {
  it("removes the worktree when the run reaches Done and the worktree differs from the main repo", async () => {
    const { deps, gitService } = buildDeps({}, makeRun({ state: RunState.ReadyForHumanReview }));
    gitService.resolveMainRepoPath.mockReturnValue("/repos/test-repo");
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/repos/test-repo", "/tmp/run-1");
  });

  it("skips worktree removal when the working directory is already the main repo", async () => {
    const { deps, gitService } = buildDeps({}, makeRun({ state: RunState.ReadyForHumanReview }));
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/run-1");
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService skill retrieval and metrics (via startRun)", () => {
  it("returns no skills and skips injection event when agentSkillRepo is not configured", async () => {
    const overrides = buildDeps();
    delete (overrides.deps as Record<string, unknown>).agentSkillRepo;
    const { deps, eventRepo, plannerAgent } = overrides;
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ priorSkills: [] }),
    );
    expect(eventRepo.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "SKILL_INJECTION" }),
    );
  });

  it("injects retrieved skills and records a SKILL_INJECTION event", async () => {
    const { deps, eventRepo, agentSkillRepo, plannerAgent } = buildDeps();
    agentSkillRepo.findTopKByRelevance.mockResolvedValue([
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "Pattern A",
        description: null,
        taskCategory: "general",
        skillMarkdown: "do X",
        utilityScore: 0.8,
        lastUsedAt: new Date(),
      },
    ]);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ priorSkills: [expect.objectContaining({ id: "skill-1" })] }),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "SKILL_INJECTION" }),
    );
  });

  it("updates skill success metrics and archives low-utility skills when a run with injected skills completes", async () => {
    const { deps, eventRepo, agentSkillRepo } = buildDeps(
      {},
      makeRun({ state: RunState.ReadyForHumanReview }),
    );
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
        createdAt: new Date(),
      },
      {
        id: "e2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("swallows per-skill metric update errors without failing the run", async () => {
    const { deps, eventRepo, agentSkillRepo, logger } = buildDeps(
      {},
      makeRun({ state: RunState.ReadyForHumanReview }),
    );
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);
    agentSkillRepo.incrementSuccess.mockRejectedValue(new Error("db down"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approveHumanReview("run-1")).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1" }),
      expect.stringContaining("Failed to update skill metric"),
    );
  });
});

describe("OrchestratorService.rejectPlan context modes", () => {
  it("in fresh mode, re-plans from feedback alone without loading prior plan context", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
    );
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "RejectionContext") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.rejectPlan("run-1", "start over please", "api", "fresh");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ previousPlan: expect.anything() }),
    );
  });

  it("in iterate mode, carries the previous plan into the re-plan call", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
    );
    const previousPlan = makePlan({ planVersion: 1, summary: "Original plan" });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: previousPlan }));
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.rejectPlan("run-1", "needs more detail", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ previousPlan: expect.objectContaining({ summary: "Original plan" }) }),
    );
  });

  it("does not persist a RejectionContext artifact when no feedback is given", async () => {
    const { deps, artifactRepo, linearClient } = buildDeps(
      {},
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.rejectPlan("run-1");

    expect(artifactRepo.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "RejectionContext" }),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("Plan rejected (iterate). Replanning"),
    );
  });
});

describe("OrchestratorService.formatExecutionReportComment file list collapsing", () => {
  it("collapses the files-changed list into a <details> block when there are more than 8 files", async () => {
    const { deps, artifactRepo, linearClient, executorAgent } = buildDeps(
      {},
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: null }),
    );
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan"
        ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }))
        : Promise.resolve(null),
    );
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: manyFiles }),
      prNumber: 42,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls.find(([, body]: [string, string]) =>
      body.includes("Files changed"),
    )?.[1];
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
  });
});
