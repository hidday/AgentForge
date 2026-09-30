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

function makePreviousPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Previous plan summary",
    requirementsTraceability: "",
    assumptions: ["Assumption A"],
    openQuestions: [
      { id: "q1", question: "Is X required?", requiredForExecution: true },
    ],
    risks: ["Risk A"],
    steps: [
      { id: "s1", title: "Old Step 1", description: "Old description" },
      { id: "s2", title: "Old Step 2", description: "Another old description" },
    ],
    testPlan: "Old test plan",
    confidence: 0.75,
    ...overrides,
  };
}

function buildPlannerAgent() {
  let capturedPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string },
        _name: unknown,
        _schema: unknown,
      ) => {
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

describe("PlannerAgent.run() -- previousPlanSection", () => {
  it("renders the previously rejected plan with steps, risks, assumptions and open questions", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", { previousPlan: makePreviousPlan() });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).toContain("Previous plan summary");
    expect(prompt).toContain("Confidence:** 75%");
    expect(prompt).toContain("1. **Old Step 1** (s1): Old description");
    expect(prompt).toContain("2. **Old Step 2** (s2): Another old description");
    expect(prompt).toContain("**Risks:**\n- Risk A");
    expect(prompt).toContain("**Assumptions:**\n- Assumption A");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("[q1] Is X required? *(blocks execution)*");
    expect(prompt).toContain("**Test Plan:** Old test plan");
  });

  it("omits risks/assumptions/open-questions sub-sections when those arrays are empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      previousPlan: makePreviousPlan({ risks: [], assumptions: [], openQuestions: [] }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("does not mark an open question as blocking when requiredForExecution is false", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      previousPlan: makePreviousPlan({
        openQuestions: [{ id: "q2", question: "Non-blocking question?", requiredForExecution: false }],
      }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("[q2] Non-blocking question?");
    expect(prompt).not.toContain("Non-blocking question? *(blocks execution)*");
  });

  it("does NOT include the previousPlanSection when previousPlan is absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("Previously Rejected Plan");
  });
});

describe("PlannerAgent.run() -- priorSkillsSection", () => {
  function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
    return {
      id: "skill-1",
      repoSlug: "acme/repo",
      name: "retry-with-backoff",
      description: "How to retry flaky network calls",
      taskCategory: "networking",
      skillMarkdown: "## Retry with backoff\n\nUse exponential backoff.",
      utilityScore: 0.9,
      lastUsedAt: new Date("2026-01-01"),
      ...overrides,
    };
  }

  it("renders prior skills with name, taskCategory and description as heading and intro", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", { priorSkills: [makeSkill()] });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### retry-with-backoff (networking)");
    expect(prompt).toContain("How to retry flaky network calls");
    expect(prompt).toContain("Use exponential backoff.");
  });

  it("falls back to taskCategory alone as heading when skill has no name", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      priorSkills: [makeSkill({ name: null, description: null })],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### networking");
    expect(prompt).not.toContain("### networking (networking)");
  });

  it("joins multiple prior skills with a blank line between them", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      priorSkills: [
        makeSkill({ id: "s1", name: "skill-one", taskCategory: "cat1" }),
        makeSkill({ id: "s2", name: "skill-two", taskCategory: "cat2" }),
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### skill-one (cat1)");
    expect(prompt).toContain("### skill-two (cat2)");
  });

  it("does NOT include priorSkillsSection when priorSkills is empty or absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", { priorSkills: [] });
    expect(getPrompt()).not.toContain("Prior Skills from Similar Tasks");

    await agent.run(bundle, "run-1");
    expect(getPrompt()).not.toContain("Prior Skills from Similar Tasks");
  });
});

describe("PlannerAgent.run() -- planReviewFindings section", () => {
  it("renders the plan review findings summary and finding lines", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      planReviewFindings: {
        summary: "Plan mostly sound",
        findings: [
          { id: "pf1", severity: "important", title: "Missing edge case", details: "detail A" },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("**Review Summary:** Plan mostly sound");
    expect(prompt).toContain("- **[important] Missing edge case** (pf1): detail A");
  });
});
