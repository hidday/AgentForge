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
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, getPrompt: () => capturedPrompt };
}

function makePreviousPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Original approach",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do the first thing" }],
    testPlan: "Run the suite",
    confidence: 0.7,
    ...overrides,
  };
}

describe("PlannerAgent.run() previousPlanSection rendering", () => {
  it("omits the previous plan section when no previousPlan is provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Previously Rejected Plan");
  });

  it("renders a minimal previous plan (no risks/assumptions/questions) without those sub-sections", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const previousPlan = makePreviousPlan();

    await agent.run(makeTaskBundle(), "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).toContain("**Summary:** Original approach");
    expect(prompt).toContain("**Confidence:** 70%");
    expect(prompt).toContain("1. **Step 1** (s1): Do the first thing");
    expect(prompt).toContain("**Test Plan:** Run the suite");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("renders risks, assumptions, and open questions (including required-for-execution markers) when present", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const previousPlan = makePreviousPlan({
      planVersion: 3,
      risks: ["Might break auth"],
      assumptions: ["DB is already migrated"],
      openQuestions: [
        { id: "q1", question: "Use Postgres?", requiredForExecution: true },
        { id: "q2", question: "Naming convention?", requiredForExecution: false },
      ],
    });

    await agent.run(makeTaskBundle(), "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).toContain("**Risks:**\n- Might break auth");
    expect(prompt).toContain("**Assumptions:**\n- DB is already migrated");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("- [q1] Use Postgres? *(blocks execution)*");
    expect(prompt).toContain("- [q2] Naming convention?");
    expect(prompt).not.toContain("[q2] Naming convention? *(blocks execution)*");
    expect(prompt).toContain(
      "Use this as the starting point for the new plan. Preserve the parts that are still valid",
    );
  });
});

describe("PlannerAgent.run() planReviewSection rendering", () => {
  it("omits the plan review findings section when planReviewFindings is not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## AI Plan Review Findings");
  });

  it("renders the summary and each finding when planReviewFindings is provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      planReviewFindings: {
        summary: "Mostly solid, one blocker to address.",
        findings: [
          {
            id: "pr1",
            severity: "blocker",
            title: "Missing rollback plan",
            details: "No rollback strategy documented for the migration step",
          },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("**Review Summary:** Mostly solid, one blocker to address.");
    expect(prompt).toContain("- **[blocker] Missing rollback plan** (pr1)");
    expect(prompt).toContain("No rollback strategy documented for the migration step");
    expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
  });
});

describe("PlannerAgent.run() priorSkillsSection rendering", () => {
  function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
    return {
      id: "skill-1",
      repoSlug: "org/repo",
      name: "auth-refactor",
      description: "How to safely refactor auth middleware",
      taskCategory: "backend-refactor",
      skillMarkdown: "1. Identify call sites\n2. Update signatures",
      utilityScore: 0.9,
      lastUsedAt: new Date("2024-01-01"),
      ...overrides,
    };
  }

  it("omits the prior skills section when no priorSkills are provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
  });

  it("omits the prior skills section when priorSkills is an empty array", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
  });

  it("renders a skill heading with name and taskCategory plus its description and markdown", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const skill = makeSkill();

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [skill] });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### auth-refactor (backend-refactor)");
    expect(prompt).toContain("How to safely refactor auth middleware");
    expect(prompt).toContain("1. Identify call sites");
  });

  it("falls back to taskCategory-only heading and omits intro line when name/description are absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const skill = makeSkill({ name: null, description: null });

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [skill] });

    const prompt = getPrompt();
    expect(prompt).toContain("### backend-refactor\n\n1. Identify call sites");
    expect(prompt).not.toContain("### auth-refactor");
  });

  it("joins multiple skill blocks with blank lines between them", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const skillA = makeSkill({ id: "a", name: "skill-a", taskCategory: "cat-a" });
    const skillB = makeSkill({ id: "b", name: "skill-b", taskCategory: "cat-b" });

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [skillA, skillB] });

    const prompt = getPrompt();
    expect(prompt).toContain("### skill-a (cat-a)");
    expect(prompt).toContain("### skill-b (cat-b)");
  });
});
