import { describe, it, expect } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { env } from "../../src/config/env.js";
import { createHarness, makeRun, makePlan } from "./orchestratorHarness.js";

const WORKTREE = "/repos/test-repo/.worktrees/run-1";

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation BEFORE the transition removes the worktree, then marks Done", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.ReadyForHumanReview }),
      withDistillation: true,
    });
    const order: string[] = [];
    h.distillationAgent.run.mockImplementation(async () => {
      order.push("distill");
    });
    h.gitService.removeWorktree.mockImplementation(async () => {
      order.push("remove-worktree");
    });

    const result = await h.svc.approveHumanReview("run-1");

    expect(order).toEqual(["distill", "remove-worktree"]);
    expect(h.distillationAgent.run).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ id: "run-1", workingDirectory: WORKTREE }),
    );
    expect(h.gitService.removeWorktree).toHaveBeenCalledWith("/repos/test-repo", WORKTREE);
    expect(result.state).toBe(RunState.Done);
    expect(h.eventTypes()).toEqual([RunEvent.HUMAN_APPROVED]);
    expect(h.state.comments.at(-1)!.body).toBe("Human review approved. Run is **Done**.");
  });

  it.each([
    [new Error("model overloaded"), "model overloaded"],
    ["plain string failure", "plain string failure"],
  ])("treats distillation failure (%s) as best-effort and still completes", async (thrown, msg) => {
    const h = createHarness({
      run: makeRun({ state: RunState.ReadyForHumanReview }),
      withDistillation: true,
    });
    h.distillationAgent.run.mockRejectedValue(thrown);

    const result = await h.svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(h.logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: msg },
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("completes without a distillation agent configured", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.ReadyForHumanReview }) });
    const result = await h.svc.approveHumanReview("run-1");
    expect(result.state).toBe(RunState.Done);
  });

  it("does not remove anything when the run's working directory IS the main repo (no worktree)", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repos/test-repo" }),
    });
    await h.svc.approveHumanReview("run-1");
    expect(h.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("cannot approve a run that is not ready for human review", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.AIReview }) });
    await expect(h.svc.approveHumanReview("run-1")).rejects.toThrow(/HUMAN_APPROVED/);
    expect(h.gitService.removeWorktree).not.toHaveBeenCalled();
    expect(h.linearClient.postComment).not.toHaveBeenCalled();
  });

  it("throws for an unknown run", async () => {
    const h = createHarness({ run: null });
    await expect(h.svc.approveHumanReview("nope")).rejects.toThrow("Run not found: nope");
  });
});

describe("OrchestratorService skill metrics on terminal states", () => {
  it("increments success once per distinct injected skill on Done and checks archival", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.ReadyForHumanReview }),
      withSkillRepo: true,
    });
    h.addEvent("SKILL_INJECTION", { skillIds: ["a", "b"] });
    h.addEvent("SKILL_INJECTION", { skillIds: ["b", "c"] });
    h.addEvent("SKILL_INJECTION", {}); // malformed payload tolerated
    h.addEvent(RunEvent.PLAN_CREATED, {});

    await h.svc.approveHumanReview("run-1");

    expect(h.agentSkillRepo.incrementSuccess.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
    expect(h.agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(3);
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "b", kind: "success" });
  });

  it("does nothing when no skills were injected", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.ReadyForHumanReview }),
      withSkillRepo: true,
    });
    await h.svc.approveHumanReview("run-1");
    expect(h.eventRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(h.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(h.agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
  });

  it("logs and continues when updating one skill fails (Error and non-Error)", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.ReadyForHumanReview }),
      withSkillRepo: true,
    });
    h.addEvent("SKILL_INJECTION", { skillIds: ["a", "b", "c"] });
    h.agentSkillRepo.incrementSuccess.mockImplementation(async (id: string) => {
      if (id === "a") throw new Error("db down");
      if (id === "b") throw "weird";
      return { id, kind: "success" };
    });

    const result = await h.svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "c", kind: "success" });
    expect(h.logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", skillId: "a", error: "db down" },
      "Failed to update skill metric",
    );
    expect(h.logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", skillId: "b", error: "weird" },
      "Failed to update skill metric",
    );
  });

  it("records failures (and cleans up the worktree) when clarification is exhausted -> Failed", async () => {
    const blocking = { id: "q1", question: "Which DB?", requiredForExecution: true };
    const h = createHarness({
      run: makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 3 }),
      withSkillRepo: true,
    });
    h.addArtifact("Plan", makePlan({ planVersion: 3, openQuestions: [blocking] }), 3);
    h.addArtifact("TaskBundle", { issue: { id: "LIN-1" } });
    h.addEvent("SKILL_INJECTION", { skillIds: ["s1"] });
    for (let i = 0; i < 3; i++) h.addEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    h.plannerAgent.run.mockImplementationOnce(async () => {
      const p = makePlan({ planVersion: 4, openQuestions: [blocking] });
      h.addArtifact("Plan", p, 4);
      return p;
    });

    const result = await h.svc.answerQuestions("run-1", [{ questionId: "q1", answer: "idk" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(h.agentSkillRepo.incrementFailure).toHaveBeenCalledWith("s1");
    expect(h.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "s1", kind: "failure" });
    expect(h.gitService.removeWorktree).toHaveBeenCalledWith("/repos/test-repo", WORKTREE);
  });
});

describe("OrchestratorService skill retrieval for planning", () => {
  it("queries by title + first 200 chars of description, records a SKILL_INJECTION event and passes skills to the planner", async () => {
    const longDesc = "d".repeat(250);
    const h = createHarness({
      run: makeRun({ state: RunState.Todo, linearIssueDescription: longDesc }),
      withSkillRepo: true,
    });
    const skills = [
      { id: "sk1", repoSlug: "test-repo", name: "n", skillMarkdown: "x" },
      { id: "sk2", repoSlug: "test-repo", name: "m", skillMarkdown: "y" },
    ];
    h.agentSkillRepo.findTopKByRelevance.mockResolvedValue(skills as never);

    await h.svc.retryRun("run-1");

    expect(h.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      `Add widget ${"d".repeat(200)}`,
      env.MAX_SKILLS_INJECTED,
    );
    const inj = h.state.events.find((e) => e.eventType === "SKILL_INJECTION")!;
    expect(inj.payloadJson).toEqual({ skillIds: ["sk1", "sk2"] });
    expect(h.plannerAgent.run.mock.calls[0]![2]).toEqual({ priorSkills: skills });
  });

  it("tolerates null title/description and records no event when nothing matches", async () => {
    const h = createHarness({
      run: makeRun({
        state: RunState.Todo,
        linearIssueTitle: null,
        linearIssueDescription: null,
      }),
      withSkillRepo: true,
    });

    await h.svc.retryRun("run-1");

    expect(h.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      " ",
      env.MAX_SKILLS_INJECTED,
    );
    expect(h.eventTypes()).not.toContain("SKILL_INJECTION");
    expect(h.plannerAgent.run.mock.calls[0]![2]).toEqual({ priorSkills: [] });
  });
});
