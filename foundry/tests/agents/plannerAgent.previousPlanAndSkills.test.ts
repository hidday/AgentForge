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
    summary: "Previous plan summary",
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

describe("PlannerAgent.run() - previousPlanSection", () => {
  it("omits the previous-plan section when previousPlan is absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("Previously Rejected Plan");
  });

  it("renders steps, confidence percentage, and test plan with empty risks/assumptions/questions", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan(),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).toContain("**Confidence:** 75%");
    expect(prompt).toContain("1. **Step one** (s1): Do the first thing");
    expect(prompt).toContain("2. **Step two** (s2): Do the second thing");
    expect(prompt).toContain("**Test Plan:** Run the full suite");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("renders risks, assumptions, and open questions (with required-for-execution marker) when present", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan({
        risks: ["Migration could fail midway"],
        assumptions: ["DB is Postgres"],
        openQuestions: [
          { id: "q1", question: "Which auth provider?", requiredForExecution: true },
          { id: "q2", question: "Optional nicety?", requiredForExecution: false },
        ],
      }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("**Risks:**\n- Migration could fail midway");
    expect(prompt).toContain("**Assumptions:**\n- DB is Postgres");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("- [q1] Which auth provider? *(blocks execution)*");
    expect(prompt).toContain("- [q2] Optional nicety?");
    expect(prompt).not.toContain("- [q2] Optional nicety? *(blocks execution)*");
  });

  it("instructs the model to preserve valid parts and address rejection feedback", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan(),
    });

    expect(getPrompt()).toContain(
      "Preserve the parts that are still valid and address the issues raised",
    );
  });
});

describe("PlannerAgent.run() - priorSkillsSection", () => {
  function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
    return {
      id: "skill-1",
      repoSlug: "org/repo",
      name: "OAuth integration pattern",
      description: "How we wired OAuth2 last time.",
      taskCategory: "auth",
      skillMarkdown: "Use the `authlib` client and refresh tokens eagerly.",
      utilityScore: 0.8,
      lastUsedAt: new Date(),
      ...overrides,
    };
  }

  it("omits the prior-skills section when priorSkills is absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    expect(getPrompt()).not.toContain("## Prior Skills from Similar Tasks");
  });

  it("omits the prior-skills section when priorSkills is an empty array", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });

    expect(getPrompt()).not.toContain("## Prior Skills from Similar Tasks");
  });

  it("renders a named skill heading with its taskCategory and description", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [makeSkill()],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### OAuth integration pattern (auth)");
    expect(prompt).toContain("How we wired OAuth2 last time.");
    expect(prompt).toContain("Use the `authlib` client and refresh tokens eagerly.");
  });

  it("falls back to the bare taskCategory heading when the skill has no name, and omits intro when no description", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [makeSkill({ name: null, description: null, taskCategory: "infra" })],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### infra\n\n");
    expect(prompt).not.toContain("### null");
  });

  it("joins multiple skills with a blank line between blocks", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        makeSkill({ id: "s1", taskCategory: "auth", name: "Skill One" }),
        makeSkill({ id: "s2", taskCategory: "infra", name: "Skill Two" }),
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### Skill One (auth)");
    expect(prompt).toContain("### Skill Two (infra)");
  });
});

describe("PlannerAgent.run() - planReviewFindings section", () => {
  it("renders the AI plan review findings section with summary and formatted findings", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      planReviewFindings: {
        summary: "Plan missed error handling.",
        findings: [
          { id: "f1", severity: "blocker", title: "No rollback plan", details: "Add one." },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("**Review Summary:** Plan missed error handling.");
    expect(prompt).toContain("- **[blocker] No rollback plan** (f1): Add one.");
    expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
  });

  it("omits the plan review findings section when absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    expect(getPrompt()).not.toContain("## AI Plan Review Findings");
  });
});
