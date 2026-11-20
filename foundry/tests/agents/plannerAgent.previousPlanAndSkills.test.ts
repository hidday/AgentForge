import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { SkillDocument } from "../../src/domain/types.js";

// Additive coverage file for PlannerAgent.run(): targets the previousPlanSection
// (options.previousPlan) and priorSkillsSection (options.priorSkills) branches
// that tests/agents/plannerAgent.test.ts does not exercise.

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

function makeRejectedPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Original rejected summary",
    requirementsTraceability: "",
    assumptions: ["Assumption A"],
    openQuestions: [
      { id: "q1", question: "Blocking question?", requiredForExecution: true },
    ],
    risks: ["Risk A"],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.6,
    ...overrides,
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

  return { agent, getPrompt: () => capturedPrompt };
}

describe("PlannerAgent.run() previousPlan rendering", () => {
  it("renders the previously rejected plan section with steps, risks, assumptions, and open questions", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const previousPlan = makeRejectedPlan();

    await agent.run(bundle, "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).toContain("Original rejected summary");
    expect(prompt).toContain("**Confidence:** 60%");
    expect(prompt).toContain("1. **Step 1** (s1): Do something");
    expect(prompt).toContain("**Risks:**");
    expect(prompt).toContain("- Risk A");
    expect(prompt).toContain("**Assumptions:**");
    expect(prompt).toContain("- Assumption A");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("[q1] Blocking question? *(blocks execution)*");
    expect(prompt).toContain("Use this as the starting point for the new plan");
  });

  it("omits the risks/assumptions/open questions lines when the previous plan has none", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const previousPlan = makeRejectedPlan({ risks: [], assumptions: [], openQuestions: [] });

    await agent.run(bundle, "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("renders an open question without the blocks-execution marker when not required", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const previousPlan = makeRejectedPlan({
      openQuestions: [{ id: "q2", question: "Optional question?", requiredForExecution: false }],
    });

    await agent.run(bundle, "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("[q2] Optional question?");
    expect(prompt).not.toContain("Optional question? *(blocks execution)*");
  });

  it("omits the previousPlanSection entirely when no previousPlan option is given", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Previously Rejected Plan");
    expect(prompt).not.toContain("{{previousPlanSection}}");
  });
});

describe("PlannerAgent.run() planReviewFindings rendering", () => {
  it("renders the AI Plan Review Findings section with summary and findings", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      planReviewFindings: {
        summary: "Mostly solid, one gap found.",
        findings: [
          {
            id: "pf1",
            severity: "important",
            title: "Missing error handling",
            details: "Malformed JSON bodies are not addressed.",
          },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("**Review Summary:** Mostly solid, one gap found.");
    expect(prompt).toContain("- **[important] Missing error handling** (pf1): Malformed JSON bodies are not addressed.");
    expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
  });

  it("omits the AI Plan Review Findings section when planReviewFindings is absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## AI Plan Review Findings");
    expect(prompt).not.toContain("{{planReviewSection}}");
  });
});

describe("PlannerAgent.run() priorSkills rendering", () => {
  it("renders prior skills with name, taskCategory, description, and markdown body", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const priorSkills: SkillDocument[] = [
      {
        id: "skill-1",
        repoSlug: "acme/backend-api",
        name: "Validation Middleware Pattern",
        taskCategory: "api-validation",
        description: "How this repo structures Zod validation middleware.",
        skillMarkdown: "Use `validateBody`/`validateQuery` helpers in src/middleware.",
        utilityScore: 0.9,
        lastUsedAt: new Date("2026-01-01"),
      },
    ];

    await agent.run(bundle, "run-1", { priorSkills });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### Validation Middleware Pattern (api-validation)");
    expect(prompt).toContain("How this repo structures Zod validation middleware.");
    expect(prompt).toContain("Use `validateBody`/`validateQuery` helpers in src/middleware.");
  });

  it("falls back to taskCategory as the heading when a skill has no name", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const priorSkills: SkillDocument[] = [
      {
        id: "skill-2",
        repoSlug: "acme/backend-api",
        name: null,
        taskCategory: "generic-task",
        description: null,
        skillMarkdown: "Some markdown body.",
        utilityScore: 0.5,
        lastUsedAt: new Date("2026-01-01"),
      },
    ];

    await agent.run(bundle, "run-1", { priorSkills });

    const prompt = getPrompt();
    expect(prompt).toContain("### generic-task");
    expect(prompt).not.toContain("### generic-task (");
    expect(prompt).toContain("Some markdown body.");
  });

  it("joins multiple prior skills with a blank line between them", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const priorSkills: SkillDocument[] = [
      {
        id: "skill-3",
        repoSlug: "acme/backend-api",
        name: "Skill One",
        taskCategory: "cat-1",
        description: null,
        skillMarkdown: "Body one.",
        utilityScore: 0.7,
        lastUsedAt: new Date("2026-01-01"),
      },
      {
        id: "skill-4",
        repoSlug: "acme/backend-api",
        name: "Skill Two",
        taskCategory: "cat-2",
        description: null,
        skillMarkdown: "Body two.",
        utilityScore: 0.6,
        lastUsedAt: new Date("2026-01-01"),
      },
    ];

    await agent.run(bundle, "run-1", { priorSkills });

    const prompt = getPrompt();
    expect(prompt).toContain("### Skill One (cat-1)");
    expect(prompt).toContain("### Skill Two (cat-2)");
    expect(prompt.indexOf("Skill One")).toBeLessThan(prompt.indexOf("Skill Two"));
  });

  it("omits the priorSkillsSection when priorSkills is empty or absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", { priorSkills: [] });

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
    expect(prompt).not.toContain("{{priorSkillsSection}}");
  });
});
