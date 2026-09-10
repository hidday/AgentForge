import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { SkillDocument } from "../../src/domain/types.js";

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
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
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const agent = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);
  return { agent, getPrompt: () => capturedPrompt };
}

const previousPlanWithExtras: Plan = {
  planVersion: 1,
  summary: "Old plan summary",
  requirementsTraceability: "",
  assumptions: ["Assumption A"],
  risks: ["Risk A"],
  openQuestions: [
    { id: "q1", question: "Required question?", requiredForExecution: true },
    { id: "q2", question: "Optional question?", requiredForExecution: false },
  ],
  steps: [{ id: "s1", title: "Old step", description: "Old description" }],
  testPlan: "Old test plan",
  confidence: 0.6,
};

describe("PlannerAgent.run() — plan review findings section", () => {
  it("renders the AI Plan Review Findings section with each finding line", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      planReviewFindings: {
        summary: "Needs auth hardening",
        findings: [
          { id: "f1", severity: "blocker", title: "Missing auth check", details: "Add a guard." },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("**Review Summary:** Needs auth hardening");
    expect(prompt).toContain("- **[blocker] Missing auth check** (f1): Add a guard.");
  });

  it("omits the plan review findings section when not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    expect(getPrompt()).not.toContain("AI Plan Review Findings");
  });
});

describe("PlannerAgent.run() — previous plan section", () => {
  it("renders the previously rejected plan with steps, assumptions, risks, and open questions", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { previousPlan: previousPlanWithExtras });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).toContain("**Summary:** Old plan summary");
    expect(prompt).toContain("**Confidence:** 60%");
    expect(prompt).toContain("1. **Old step** (s1): Old description");
    expect(prompt).toContain("**Assumptions:**\n- Assumption A");
    expect(prompt).toContain("**Risks:**\n- Risk A");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("- [q1] Required question? *(blocks execution)*");
    expect(prompt).toContain("- [q2] Optional question?");
    expect(prompt).not.toContain("- [q2] Optional question? *(blocks execution)*");
  });

  it("omits assumptions/risks/questions blocks when the previous plan has none of them", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bareplan: Plan = {
      ...previousPlanWithExtras,
      assumptions: [],
      risks: [],
      openQuestions: [],
    };

    await agent.run(makeTaskBundle(), "run-1", { previousPlan: bareplan });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("omits the previous plan section entirely when not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    expect(getPrompt()).not.toContain("Previously Rejected Plan");
  });
});

describe("PlannerAgent.run() — prior skills section", () => {
  function makeSkillDoc(overrides: Partial<SkillDocument> = {}): SkillDocument {
    return {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "auth-middleware",
      description: "Use when adding auth middleware.",
      taskCategory: "auth",
      skillMarkdown: "Always validate JWTs server-side.",
      utilityScore: 0.5,
      lastUsedAt: new Date(),
      ...overrides,
    };
  }

  it("renders a heading with name and taskCategory, plus description and markdown body", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [makeSkillDoc()] });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### auth-middleware (auth)");
    expect(prompt).toContain("Use when adding auth middleware.");
    expect(prompt).toContain("Always validate JWTs server-side.");
  });

  it("falls back to taskCategory alone as the heading when the skill has no name", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [makeSkillDoc({ name: null })],
    });

    expect(getPrompt()).toContain("### auth");
  });

  it("omits the description intro line when the skill has no description", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [makeSkillDoc({ description: null })],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### auth-middleware (auth)");
    expect(prompt).toContain("Always validate JWTs server-side.");
  });

  it("joins multiple prior skills with blank-line separation", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [makeSkillDoc({ id: "s1", name: "skill-one" }), makeSkillDoc({ id: "s2", name: "skill-two" })],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### skill-one (auth)");
    expect(prompt).toContain("### skill-two (auth)");
  });

  it("omits the prior skills section when the array is empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });

    expect(getPrompt()).not.toContain("Prior Skills from Similar Tasks");
  });

  it("omits the prior skills section when not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    expect(getPrompt()).not.toContain("Prior Skills from Similar Tasks");
  });
});
