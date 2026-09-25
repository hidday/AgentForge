import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { SkillDocument } from "../../src/domain/types.js";

// Gap-fill tests for PlannerAgent.run(): covers the `previousPlanSection` and
// `priorSkillsSection` template-variable branches that the main
// tests/agents/plannerAgent.test.ts suite does not exercise.

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
    planVersion: 3,
    summary: "Original approach using a queue.",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [
      { id: "s1", title: "Step one", description: "Do the first thing" },
      { id: "s2", title: "Step two", description: "Do the second thing" },
    ],
    testPlan: "Run the full suite",
    confidence: 0.75,
    ...overrides,
  };
}

describe("PlannerAgent.run() — previousPlanSection", () => {
  it("renders the previous plan section including risks, assumptions and open questions when present", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const previousPlan = makePreviousPlan({
      risks: ["Queue backlog could grow unbounded"],
      assumptions: ["Redis is available in all environments"],
      openQuestions: [
        { id: "q1", question: "Should we cap queue depth?", requiredForExecution: true },
        { id: "q2", question: "Is TTL configurable?", requiredForExecution: false },
      ],
    });

    await agent.run(bundle, "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).toContain("**Summary:** Original approach using a queue.");
    expect(prompt).toContain("**Confidence:** 75%");
    expect(prompt).toContain("1. **Step one** (s1): Do the first thing");
    expect(prompt).toContain("2. **Step two** (s2): Do the second thing");
    expect(prompt).toContain("**Risks:**\n- Queue backlog could grow unbounded");
    expect(prompt).toContain("**Assumptions:**\n- Redis is available in all environments");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("- [q1] Should we cap queue depth? *(blocks execution)*");
    expect(prompt).toContain("- [q2] Is TTL configurable?");
    expect(prompt).not.toContain("[q2] Is TTL configurable? *(blocks execution)*");
    expect(prompt).toContain("**Test Plan:** Run the full suite");
    expect(prompt).toContain("Use this as the starting point for the new plan");
  });

  it("omits the risks/assumptions/open-questions sub-sections when those arrays are empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const previousPlan = makePreviousPlan({ risks: [], assumptions: [], openQuestions: [] });

    await agent.run(bundle, "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("omits the previous plan section entirely when options.previousPlan is not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Previously Rejected Plan");
    expect(prompt).not.toContain("{{previousPlanSection}}");
  });
});

describe("PlannerAgent.run() — planReviewSection", () => {
  it("renders the AI plan review findings section with summary and formatted findings", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      planReviewFindings: {
        summary: "Plan is missing error-handling for malformed input.",
        findings: [
          {
            id: "pf1",
            severity: "important",
            title: "No malformed-JSON handling",
            details: "Add a step for the body-parser error path.",
          },
          {
            id: "pf2",
            severity: "suggestion",
            title: "Consider OpenAPI generation",
            details: "Optional, out of scope.",
          },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain(
      "**Review Summary:** Plan is missing error-handling for malformed input.",
    );
    expect(prompt).toContain(
      "- **[important] No malformed-JSON handling** (pf1): Add a step for the body-parser error path.",
    );
    expect(prompt).toContain(
      "- **[suggestion] Consider OpenAPI generation** (pf2): Optional, out of scope.",
    );
    expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
  });

  it("omits the plan review section when planReviewFindings is not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## AI Plan Review Findings");
    expect(prompt).not.toContain("{{planReviewSection}}");
  });
});

describe("PlannerAgent.run() — priorSkillsSection", () => {
  function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
    return {
      id: "skill-1",
      repoSlug: "acme/backend-api",
      name: "Zod validation middleware",
      description: "How to wire Zod-based request validation into Fastify routes.",
      taskCategory: "validation",
      skillMarkdown: "1. Create a middleware.\n2. Apply it to routes.",
      utilityScore: 0.8,
      lastUsedAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    };
  }

  it("renders a heading with name + taskCategory and the description when both are present", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const skill = makeSkill();

    await agent.run(bundle, "run-1", { priorSkills: [skill] });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### Zod validation middleware (validation)");
    expect(prompt).toContain("How to wire Zod-based request validation into Fastify routes.");
    expect(prompt).toContain("1. Create a middleware.\n2. Apply it to routes.");
  });

  it("falls back to just the taskCategory as the heading and omits the intro when name/description are null", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const skill = makeSkill({ name: null, description: null, taskCategory: "auth" });

    await agent.run(bundle, "run-1", { priorSkills: [skill] });

    const prompt = getPrompt();
    expect(prompt).toContain("### auth\n\n1. Create a middleware.\n2. Apply it to routes.");
  });

  it("joins multiple skills with a blank line between blocks", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const skillA = makeSkill({ id: "a", name: "Skill A", taskCategory: "cat-a" });
    const skillB = makeSkill({ id: "b", name: "Skill B", taskCategory: "cat-b" });

    await agent.run(bundle, "run-1", { priorSkills: [skillA, skillB] });

    const prompt = getPrompt();
    expect(prompt).toContain("### Skill A (cat-a)");
    expect(prompt).toContain("### Skill B (cat-b)");
    expect(prompt.indexOf("### Skill A")).toBeLessThan(prompt.indexOf("### Skill B"));
  });

  it("omits the prior skills section when priorSkills is absent or empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", { priorSkills: [] });

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
    expect(prompt).not.toContain("{{priorSkillsSection}}");
  });
});
