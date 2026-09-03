import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, makeStore } from "./helpers/fixtures.js";

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts a completion comment", async () => {
    const store = makeStore({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(store);
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const svc = new OrchestratorService({
      ...built.deps,
      distillationAgent,
    } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.HUMAN_APPROVED);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Run is **Done**"),
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("swallows a distillation agent failure (best-effort) and still completes the run", async () => {
    const store = makeStore({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(store);
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation exploded")) };
    const svc = new OrchestratorService({
      ...built.deps,
      distillationAgent,
    } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation exploded" }),
      expect.stringContaining("Distillation agent failed"),
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("skips distillation entirely when no distillationAgent dependency is configured", async () => {
    const store = makeStore({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).not.toHaveBeenCalled();
  });

  it("cleans up the worktree and updates skill metrics for injected skills on completion", async () => {
    const store = makeStore({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" });
    store.events.push({
      id: "evt-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-a", "skill-b"] },
      createdAt: new Date(),
    });
    const built = buildDeps(store);
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue({
        id: "skill-a",
        utilityScore: 0.5,
        successCount: 3,
        failureCount: 1,
      }),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const svc = new OrchestratorService({
      ...built.deps,
      agentSkillRepo,
    } as never);

    await svc.approveHumanReview("run-1");

    expect(built.gitService.resolveMainRepoPath).toHaveBeenCalledWith("/tmp/worktree");
    // resolveMainRepoPath is mocked to return "/tmp", which differs from the
    // run's workingDirectory ("/tmp/worktree"), so cleanup should proceed.
    expect(built.gitService.removeWorktree).toHaveBeenCalledWith("/tmp", "/tmp/worktree");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-b");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("does not attempt worktree cleanup when the working directory already IS the main repo path", async () => {
    const store = makeStore({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const built = buildDeps(store);
    // resolveMainRepoPath default mock returns "/tmp" -- same as workingDirectory.
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("skips skill metric updates when there is no agentSkillRepo dependency", async () => {
    const store = makeStore({ state: RunState.ReadyForHumanReview });
    store.events.push({
      id: "evt-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-a"] },
      createdAt: new Date(),
    });
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    // Should not throw despite no agentSkillRepo being configured.
    await expect(svc.approveHumanReview("run-1")).resolves.toMatchObject({ state: RunState.Done });
  });

  it("continues updating remaining skills when incrementSuccess throws for one of them", async () => {
    const store = makeStore({ state: RunState.ReadyForHumanReview });
    store.events.push({
      id: "evt-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-bad", "skill-good"] },
      createdAt: new Date(),
    });
    const built = buildDeps(store);
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockImplementation((id: string) => {
        if (id === "skill-bad") return Promise.reject(new Error("db exploded"));
        return Promise.resolve({ id, utilityScore: 0.5, successCount: 1, failureCount: 0 });
      }),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const svc = new OrchestratorService({
      ...built.deps,
      agentSkillRepo,
    } as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-bad");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-good");
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-bad", error: "db exploded" }),
      expect.stringContaining("Failed to update skill metric"),
    );
    // The second skill's metric update still happened despite the first failing.
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });

  it("dedupes skill IDs injected across multiple planning passes before updating metrics", async () => {
    const store = makeStore({ state: RunState.ReadyForHumanReview });
    store.events.push(
      {
        id: "evt-skill-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-a", "skill-b"] },
        createdAt: new Date(),
      },
      {
        id: "evt-skill-2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-b", "skill-c"] },
        createdAt: new Date(),
      },
    );
    const built = buildDeps(store);
    const agentSkillRepo = {
      incrementSuccess: vi
        .fn()
        .mockResolvedValue({ id: "x", utilityScore: 0.5, successCount: 1, failureCount: 0 }),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const svc = new OrchestratorService({
      ...built.deps,
      agentSkillRepo,
    } as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(3);
    const calledIds = agentSkillRepo.incrementSuccess.mock.calls.map((c: unknown[]) => c[0]);
    expect(new Set(calledIds)).toEqual(new Set(["skill-a", "skill-b", "skill-c"]));
  });
});
