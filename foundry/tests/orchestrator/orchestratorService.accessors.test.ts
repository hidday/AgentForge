import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

function buildDeps() {
  const runRepo = { findById: vi.fn(), findActiveByIssueId: vi.fn(), findAll: vi.fn(), create: vi.fn(), findByIssueId: vi.fn(), updateState: vi.fn(), update: vi.fn() };
  const artifactRepo = { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn(), findByRunId: vi.fn() };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn() };
  const githubClient = { getPRDiff: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn() };
  const githubSync = { syncState: vi.fn(), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn(),
    resolveMainRepoPath: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const agentSkillRepo = { findTopKByRelevance: vi.fn() };

  return {
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    logger,
    agentSkillRepo,
  };
}

describe("OrchestratorService -- dependency accessors", () => {
  it("exposes the exact runRepo, artifactRepo, eventRepo, agentSkillRepo, and linearClient instances it was constructed with", () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(deps.runRepo);
    expect(svc.getArtifactRepo()).toBe(deps.artifactRepo);
    expect(svc.getEventRepo()).toBe(deps.eventRepo);
    expect(svc.getAgentSkillRepo()).toBe(deps.agentSkillRepo);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
  });

  it("getAgentSkillRepo returns undefined when no agentSkillRepo was configured", () => {
    const deps = buildDeps();
    const { agentSkillRepo: _omit, ...rest } = deps;
    const svc = new OrchestratorService(rest as never);

    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});
