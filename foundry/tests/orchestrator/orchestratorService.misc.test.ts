import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildFullDeps, makeRun, makePlan, makePlanReview } from "./_helpers/fixtures.js";

describe("OrchestratorService.requireRun (private, via any public method)", () => {
  it("throws 'Run not found' when runRepo.findById returns null", async () => {
    const run = makeRun({ id: "run-1" });
    const { deps, runRepo } = buildFullDeps(run);
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});

describe("buildTaskBundle non-Error catch branches (via runPlanReview)", () => {
  it("falls back to the configured default branch when GitHub lookup rejects with a non-Error value", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps, artifactRepo, githubClient, planReviewerAgent, logger } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    githubClient.getDefaultBranch.mockRejectedValue("plain string rejection");
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "plain string rejection" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("proceeds without relatedContext when getRelatedContext rejects with a non-Error value", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps, artifactRepo, linearClient, planReviewerAgent, logger } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    linearClient.getRelatedContext.mockRejectedValue({ code: "ECONNRESET" });
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "[object Object]" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
  });
});

describe("retrieveSkillsForPlanning null title/description fallback (via retryRun)", () => {
  it("builds the relevance query using empty-string fallbacks when title/description are null", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Todo,
      linearIssueTitle: null,
      linearIssueDescription: null,
    });
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, artifactRepo, plannerAgent } = buildFullDeps(run, { agentSkillRepo });
    const newPlan = makePlan({ openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.seed("Plan", newPlan);

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      " ",
      expect.any(Number),
    );
  });
});

describe("updateSkillMetrics additional branches (via approveHumanReview)", () => {
  it("treats a SKILL_INJECTION event with a missing skillIds field as contributing no ids", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo } = buildFullDeps(run, { agentSkillRepo });
    // No `skillIds` key at all in the payload.
    await eventRepo.create({ runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: {} });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("logs a string error (non-Error rejection) when agentSkillRepo.archiveIfLowUtility rejects", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const updatedSkill = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "s",
      description: "d",
      taskCategory: "t",
      skillMarkdown: "#",
      utilityScore: 1,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      // Rejects with a plain string, not an Error instance.
      archiveIfLowUtility: vi.fn().mockRejectedValue("quota exceeded"),
    };
    const { deps, eventRepo, logger } = buildFullDeps(run, { agentSkillRepo });
    await eventRepo.create({
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1"] },
    });

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "quota exceeded" }),
      "Failed to update skill metric",
    );
  });
});

describe("runManualPlanRevision without an operator note", () => {
  it("passes undefined opts to runPlanRevision when no note is given (changes_requested path)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, artifactRepo, planReviewerAgent, planReviserAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    artifactRepo.seed("PlanReview", makePlanReview({ overallVerdict: "changes_requested" }));
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "gap", title: "x", details: "y" }],
      }),
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("approveHumanReview distillation failure with a non-Error rejection", () => {
  it("logs the stringified value when the distillation agent rejects with a non-Error", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const distillationAgent = { run: vi.fn().mockRejectedValue("timeout") };
    const { deps, logger } = buildFullDeps(run, { distillationAgent });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "timeout" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
    expect(result.state).toBe(RunState.Done);
  });
});
