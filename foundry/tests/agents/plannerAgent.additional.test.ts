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

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);
  return { agent, getPrompt: () => capturedPrompt };
}

function makePreviousPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Old summary",
    requirementsTraceability: "",
    assumptions: ["Assumption A"],
    openQuestions: [{ id: "q1", question: "Old question?", requiredForExecution: true }],
    risks: ["Risk A"],
    steps: [{ id: "s1", title: "Old step", description: "Old description" }],
    testPlan: "Old test plan",
    confidence: 0.75,
    ...overrides,
  };
}

describe("PlannerAgent.run() previousPlanSection rendering", () => {
  it("renders the full previous-plan section including steps, risks, assumptions and open questions", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { previousPlan: makePreviousPlan() });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).toContain("**Summary:** Old summary");
    expect(prompt).toContain("**Confidence:** 75%");
    expect(prompt).toContain("1. **Old step** (s1): Old description");
    expect(prompt).toContain("**Risks:**\n- Risk A");
    expect(prompt).toContain("**Assumptions:**\n- Assumption A");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("Old question?");
    expect(prompt).toContain("*(blocks execution)*");
    expect(prompt).toContain("**Test Plan:** Old test plan");
    expect(prompt).toContain("Preserve the parts that are still valid");
  });

  it("omits risks/assumptions/open-questions sub-sections when those arrays are empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan({ risks: [], assumptions: [], openQuestions: [] }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("does not append the blocks-execution marker for a previous-plan open question that doesn't require it", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan({
        openQuestions: [
          { id: "q1", question: "Optional question?", requiredForExecution: false },
        ],
      }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("Optional question?");
    expect(prompt).not.toContain("Optional question? *(blocks execution)*");
  });

  it("omits the previous-plan section entirely when no previousPlan option is given", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Previously Rejected Plan");
    expect(prompt).not.toContain("{{previousPlanSection}}");
  });
});

describe("PlannerAgent.run() priorSkillsSection rendering", () => {
  function makeSkills(): SkillDocument[] {
    return [
      {
        id: "skill-1",
        repoSlug: "acme/backend",
        name: "zod-validation-pattern",
        taskCategory: "api-validation",
        description: "How this repo validates request bodies",
        skillMarkdown: "Use Zod schemas with `.strip()` on all POST/PUT bodies.",
        utilityScore: 1,
        lastUsedAt: new Date("2026-01-01"),
      },
      {
        id: "skill-2",
        repoSlug: "acme/backend",
        name: null,
        taskCategory: "testing-conventions",
        description: null,
        skillMarkdown: "Use Vitest with colocated test files.",
        utilityScore: 1,
        lastUsedAt: new Date("2026-01-01"),
      },
    ];
  }

  it("renders each prior skill as a heading block, using name+category when name is present", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: makeSkills() });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### zod-validation-pattern (api-validation)");
    expect(prompt).toContain("How this repo validates request bodies");
    expect(prompt).toContain("Use Zod schemas with `.strip()`");
  });

  it("falls back to just the taskCategory as the heading when name is absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: makeSkills() });

    const prompt = getPrompt();
    expect(prompt).toContain("### testing-conventions");
    expect(prompt).not.toContain("### testing-conventions (testing-conventions)");
    expect(prompt).toContain("Use Vitest with colocated test files.");
  });

  it("omits the priorSkillsSection when priorSkills is undefined", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
    expect(prompt).not.toContain("{{priorSkillsSection}}");
  });
});

describe("PlannerAgent.run() planReviewSection rendering", () => {
  it("renders AI Plan Review Findings when planReviewFindings is provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      planReviewFindings: {
        summary: "Missing error handling step",
        findings: [
          { id: "pf1", severity: "important", title: "No error handling", details: "Add it" },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("**Review Summary:** Missing error handling step");
    expect(prompt).toContain("- **[important] No error handling** (pf1): Add it");
  });

  it("omits the planReviewSection when planReviewFindings is undefined", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## AI Plan Review Findings");
    expect(prompt).not.toContain("{{planReviewSection}}");
  });
});
