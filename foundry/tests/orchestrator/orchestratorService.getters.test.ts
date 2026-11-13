import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

// Thin accessor methods used by API routes to reach the service's injected
// repositories/clients directly. Covered here for completeness since they
// are part of the public surface of OrchestratorService.
describe("OrchestratorService accessors", () => {
  function buildMinimalDeps(overrides: Record<string, unknown> = {}) {
    return {
      runRepo: { marker: "runRepo" },
      artifactRepo: { marker: "artifactRepo" },
      eventRepo: { marker: "eventRepo" },
      linearClient: { marker: "linearClient" },
      githubClient: {},
      gitService: {},
      repoRegistry: {},
      linearSync: {},
      githubSync: {},
      plannerAgent: {},
      planReviewerAgent: {},
      planReviserAgent: {},
      executorAgent: {},
      reviewerAgent: {},
      remediationAgent: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      ...overrides,
    };
  }

  it("getRunRepo returns the injected run repository", () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    expect(svc.getRunRepo()).toBe(deps.runRepo);
  });

  it("getArtifactRepo returns the injected artifact repository", () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    expect(svc.getArtifactRepo()).toBe(deps.artifactRepo);
  });

  it("getEventRepo returns the injected event repository", () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    expect(svc.getEventRepo()).toBe(deps.eventRepo);
  });

  it("getLinearClient returns the injected linear client", () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
  });

  it("getAgentSkillRepo returns the injected agentSkillRepo when configured", () => {
    const agentSkillRepo = { marker: "agentSkillRepo" };
    const deps = buildMinimalDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });

  it("getAgentSkillRepo returns undefined when not configured", () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});
