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

function makePlanOutput() {
  return {
    raw: "raw text",
    parsed: {
      payload: {
        planVersion: 2,
        summary: "New plan",
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

function makePreviousPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Original plan summary",
    requirementsTraceability: "Traceability",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Original step", description: "Original description" }],
    testPlan: "Original test plan",
    confidence: 0.6,
    ...overrides,
  };
}

function buildPlannerAgent() {
  let capturedPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return makePlanOutput();
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, getPrompt: () => capturedPrompt };
}

describe("PlannerAgent.run() previousPlanSection rendering", () => {
  it("omits the '## Previously Rejected Plan' section when previousPlan is not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    expect(getPrompt()).not.toContain("## Previously Rejected Plan");
  });

  it("renders summary, confidence and steps, but omits Risks/Assumptions/Open Questions when those are empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const previousPlan = makePreviousPlan({
      planVersion: 3,
      summary: "Original plan summary",
      confidence: 0.75,
      risks: [],
      assumptions: [],
      openQuestions: [],
    });

    await agent.run(makeTaskBundle(), "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).toContain("**Summary:** Original plan summary");
    expect(prompt).toContain("**Confidence:** 75%");
    expect(prompt).toContain("1. **Original step** (s1): Original description");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Open Questions:**");
    expect(prompt).toContain(
      "Use this as the starting point for the new plan. Preserve the parts that are still valid",
    );
  });

  it("renders Risks, Assumptions and Open Questions sections when they are non-empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const previousPlan = makePreviousPlan({
      risks: ["Risk of data loss"],
      assumptions: ["Assumes Postgres is available"],
      openQuestions: [
        { id: "q1", question: "Blocking question?", requiredForExecution: true },
        { id: "q2", question: "Optional question?", requiredForExecution: false },
      ],
    });

    await agent.run(makeTaskBundle(), "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("**Risks:**");
    expect(prompt).toContain("- Risk of data loss");
    expect(prompt).toContain("**Assumptions:**");
    expect(prompt).toContain("- Assumes Postgres is available");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("- [q1] Blocking question? *(blocks execution)*");
    expect(prompt).toContain("- [q2] Optional question?");
    expect(prompt).not.toContain("- [q2] Optional question? *(blocks execution)*");
  });

  it("renders multiple steps, each numbered", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const previousPlan = makePreviousPlan({
      steps: [
        { id: "s1", title: "First", description: "Do first" },
        { id: "s2", title: "Second", description: "Do second" },
      ],
    });

    await agent.run(makeTaskBundle(), "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("1. **First** (s1): Do first");
    expect(prompt).toContain("2. **Second** (s2): Do second");
  });
});

describe("PlannerAgent.run() priorSkillsSection rendering", () => {
  function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
    return {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "auth-middleware",
      description: "Use when adding auth middleware.",
      taskCategory: "auth middleware",
      skillMarkdown: "Use JWT tokens.",
      utilityScore: 0.5,
      lastUsedAt: new Date("2024-01-01"),
      ...overrides,
    } as SkillDocument;
  }

  it("omits the '## Prior Skills from Similar Tasks' section when priorSkills is not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    expect(getPrompt()).not.toContain("## Prior Skills from Similar Tasks");
  });

  it("omits the section when priorSkills is an empty array", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });

    expect(getPrompt()).not.toContain("## Prior Skills from Similar Tasks");
  });

  it("renders a skill heading with name + taskCategory and its description when both are present", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const skill = makeSkill({
      name: "auth-middleware",
      taskCategory: "auth middleware",
      description: "Use when adding JWT auth middleware.",
      skillMarkdown: "Always validate the JWT signature.",
    });

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [skill] });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### auth-middleware (auth middleware)");
    expect(prompt).toContain("Use when adding JWT auth middleware.");
    expect(prompt).toContain("Always validate the JWT signature.");
  });

  it("falls back to taskCategory alone as the heading when skill.name is null", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const skill = makeSkill({ name: null, taskCategory: "database migration" });

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [skill] });

    const prompt = getPrompt();
    expect(prompt).toContain("### database migration\n");
    expect(prompt).not.toContain("### database migration (database migration)");
  });

  it("omits the description intro line when skill.description is null", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const skill = makeSkill({ description: null, skillMarkdown: "Markdown body only." });

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [skill] });

    const prompt = getPrompt();
    expect(prompt).toContain("Markdown body only.");
    const idx = prompt.indexOf("### auth-middleware");
    const block = prompt.slice(idx, idx + 200);
    // No blank "intro" paragraph inserted before the markdown body.
    expect(block).toMatch(/### auth-middleware \(auth middleware\)\n\nMarkdown body only\./);
  });

  it("joins multiple prior skills with a blank line between them", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const skillA = makeSkill({ id: "a", name: "skill-a", taskCategory: "cat-a" });
    const skillB = makeSkill({ id: "b", name: "skill-b", taskCategory: "cat-b" });

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [skillA, skillB] });

    const prompt = getPrompt();
    expect(prompt).toContain("### skill-a (cat-a)");
    expect(prompt).toContain("### skill-b (cat-b)");
  });
});
