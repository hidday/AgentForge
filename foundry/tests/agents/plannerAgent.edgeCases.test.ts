import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { SkillDocument } from "../../src/domain/types.js";

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
  };
}

function makePlanOutput(planVersion = 2) {
  return {
    raw: "raw text",
    parsed: {
      payload: {
        planVersion,
        summary: "Test plan",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
        testPlan: "Run tests",
        confidence: 0.9,
      },
    },
  };
}

function buildPlannerAgent() {
  let capturedPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return makePlanOutput();
      },
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, agentRunner, artifactRepo, getPrompt: () => capturedPrompt };
}

function makePreviousPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Old plan summary",
    requirementsTraceability: "Traceability",
    assumptions: [],
    risks: [],
    openQuestions: [],
    steps: [{ id: "s1", title: "Old step", description: "Old description" }],
    testPlan: "Old test plan",
    confidence: 0.75,
    ...overrides,
  };
}

describe("PlannerAgent.run() previousPlanSection", () => {
  it("renders the previous plan section with steps, test plan, and confidence percentage", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const previousPlan = makePreviousPlan({ planVersion: 3, confidence: 0.6 });

    await agent.run(bundle, "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).toContain("**Summary:** Old plan summary");
    expect(prompt).toContain("**Confidence:** 60%");
    expect(prompt).toContain("1. **Old step** (s1): Old description");
    expect(prompt).toContain("**Test Plan:** Old test plan");
    expect(prompt).toContain("Use this as the starting point for the new plan");
  });

  it("includes risks and assumptions sections when present on the previous plan", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const previousPlan = makePreviousPlan({
      risks: ["Risk one", "Risk two"],
      assumptions: ["Assumption one"],
    });

    await agent.run(bundle, "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("**Risks:**");
    expect(prompt).toContain("- Risk one");
    expect(prompt).toContain("- Risk two");
    expect(prompt).toContain("**Assumptions:**");
    expect(prompt).toContain("- Assumption one");
  });

  it("omits risks and assumptions sections when they are empty arrays", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const previousPlan = makePreviousPlan({ risks: [], assumptions: [] });

    await agent.run(bundle, "run-1", { previousPlan });

    const prompt = getPrompt();
    const idx = prompt.indexOf("## Previously Rejected Plan");
    const section = prompt.slice(idx, idx + 600);
    expect(section).not.toContain("**Risks:**");
    expect(section).not.toContain("**Assumptions:**");
  });

  it("includes open questions with the blocks-execution marker when requiredForExecution is true", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const previousPlan = makePreviousPlan({
      openQuestions: [
        { id: "q1", question: "Should we use OAuth?", requiredForExecution: true },
        { id: "q2", question: "Optional nit?", requiredForExecution: false },
      ],
    });

    await agent.run(bundle, "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("- [q1] Should we use OAuth? *(blocks execution)*");
    expect(prompt).toContain("- [q2] Optional nit?");
    expect(prompt).not.toContain("- [q2] Optional nit? *(blocks execution)*");
  });

  it("omits the previousPlanSection entirely when previousPlan is not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Previously Rejected Plan");
    expect(prompt).not.toContain("{{previousPlanSection}}");
  });
});

describe("PlannerAgent.run() priorSkillsSection", () => {
  function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
    return {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "auth-middleware",
      description: "Use when adding auth middleware.",
      taskCategory: "auth middleware",
      skillMarkdown: "Always use JWT tokens with RS256.",
      utilityScore: 0.8,
      lastUsedAt: new Date(),
      ...overrides,
    };
  }

  it("renders a heading combining name and taskCategory, plus description and markdown", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const skill = makeSkill();

    await agent.run(bundle, "run-1", { priorSkills: [skill] });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### auth-middleware (auth middleware)");
    expect(prompt).toContain("Use when adding auth middleware.");
    expect(prompt).toContain("Always use JWT tokens with RS256.");
  });

  it("falls back to just the taskCategory as heading when name is null", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const skill = makeSkill({ name: null, taskCategory: "database migration" });

    await agent.run(bundle, "run-1", { priorSkills: [skill] });

    const prompt = getPrompt();
    expect(prompt).toContain("### database migration\n");
    expect(prompt).not.toContain("### database migration (database migration)");
  });

  it("omits the description intro line when description is null", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const skill = makeSkill({ description: null, skillMarkdown: "Markdown body only." });

    await agent.run(bundle, "run-1", { priorSkills: [skill] });

    const prompt = getPrompt();
    const idx = prompt.indexOf("## Prior Skills from Similar Tasks");
    const section = prompt.slice(idx, idx + 300);
    expect(section).toContain("Markdown body only.");
  });

  it("joins multiple skill blocks with a blank line between them", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const skillA = makeSkill({ id: "a", name: "skill-a", taskCategory: "cat-a" });
    const skillB = makeSkill({ id: "b", name: "skill-b", taskCategory: "cat-b" });

    await agent.run(bundle, "run-1", { priorSkills: [skillA, skillB] });

    const prompt = getPrompt();
    expect(prompt).toContain("### skill-a (cat-a)");
    expect(prompt).toContain("### skill-b (cat-b)");
  });

  it("omits the priorSkillsSection entirely when priorSkills is undefined", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
    expect(prompt).not.toContain("{{priorSkillsSection}}");
  });
});
