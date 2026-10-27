import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RunDetailPage } from "./RunDetailPage.tsx";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    reReviewPlan: vi.fn(),
    revisePlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    retryStage: vi.fn(),
    answerQuestions: vi.fn(),
    sendChatMessage: vi.fn(),
  },
}));

const mockUseRun = vi.fn();
const mockUseRunSkills = vi.fn();
const mockUseActiveProcesses = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (id: string) => mockUseRun(id),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => mockUseRunSkills(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => mockUseActiveProcesses(id),
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the login bug",
    linearIssueUrl: "https://linear.app/acme/issue/ENG-1",
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "a1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function defaultRunSkills() {
  return { data: null, loading: false, error: null };
}

function defaultActiveProcesses() {
  return { processes: [], output: "" };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-1"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRunSkills.mockReturnValue(defaultRunSkills());
    mockUseActiveProcesses.mockReturnValue(defaultActiveProcesses());
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows an error message when the run fails to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run fetch failed",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run fetch failed")).toBeDefined();
  });

  it("shows a fallback 'Run not found' message when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run header: id, issue link, repo and state badge", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("run-1".slice(0, 8))).toBeDefined();
    expect(screen.getByText("Fix the login bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
    // Implementing state badge (WorkflowStepper also shows "Implementing" as
    // a step label, so there are two matches on the page).
    expect(screen.getAllByText("Implementing").length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the issue identifier in the header when title is missing", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-9" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("ENG-9")).toBeDefined();
  });

  it("shows branch, PR, Cursor and Claude links only when branchName and workingDirectory are set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({
          branchName: "fix/login-bug",
          workingDirectory: "/work/run-1",
          prNumber: 7,
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("fix/login-bug")).toBeDefined();
    expect(screen.getByTitle("Open PR on GitHub")).toBeDefined();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });

  it("omits branch/PR/editor links when branchName is absent", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ branchName: null, prNumber: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("renders the ArtifactTabs with data from the Plan artifact", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun(),
        artifacts: [makeArtifact({ type: "Plan", payloadJson: { summary: "Plan summary text" } })],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Plan summary text")).toBeDefined();
  });

  it("renders the EventTimeline with the run's events", () => {
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "human",
        payloadJson: null,
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("shows the interactive OpenQuestionsPanel for HumanClarificationNeeded with required questions", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [
          makeArtifact({
            type: "Plan",
            payloadJson: {
              openQuestions: [
                { id: "q1", question: "Which DB do we target?", requiredForExecution: true },
              ],
            },
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const panel = within(screen.getByLabelText("Open Questions"));
    expect(panel.getByText("Which DB do we target?")).toBeDefined();
    expect(panel.getByText("Required")).toBeDefined();
  });

  it("shows only optional questions in a secondary panel for AwaitingPlanApproval", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [
          makeArtifact({
            type: "Plan",
            payloadJson: {
              openQuestions: [
                { id: "q1", question: "Required one", requiredForExecution: true },
                { id: "q2", question: "Optional one", requiredForExecution: false },
              ],
            },
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const panel = within(screen.getByLabelText("Open Questions"));
    expect(panel.getByText("Optional one")).toBeDefined();
    expect(panel.queryByText("Required one")).toBeNull();
    // The ActionBar should expose an "Answer Optional Questions" trigger too.
    expect(screen.getByRole("button", { name: /answer optional questions/i })).toBeDefined();
  });

  it("scrolls the questions panel into view when the ActionBar's scroll trigger is used", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = (
      HTMLDivElement.prototype as unknown as { scrollIntoView?: () => void }
    ).scrollIntoView;
    (HTMLDivElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      scrollIntoView;

    try {
      mockUseRun.mockReturnValue({
        data: {
          run: makeRun({ state: "HumanClarificationNeeded" }),
          artifacts: [
            makeArtifact({
              type: "Plan",
              payloadJson: {
                openQuestions: [
                  { id: "q1", question: "Needs an answer", requiredForExecution: true },
                ],
              },
            }),
          ],
          events: [],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderPage();

      await userEvent.click(screen.getByRole("button", { name: /answer questions/i }));
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    } finally {
      (HTMLDivElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView =
        originalScrollIntoView;
    }
  });

  it("renders the DistilledSkillPanel using data from useRunSkills", () => {
    mockUseRunSkills.mockReturnValue({
      data: {
        injectedSkills: [],
        distillationDecision: { shouldPersist: true, reason: "ok", taskCategory: "t", name: "my-skill", description: "d", displacedSkillId: null },
        distilledSkill: {
          id: "s1",
          repoSlug: "acme/widgets",
          name: "my-skill",
          description: "d",
          taskCategory: "t",
          skillMarkdown: "# content",
          utilityScore: 0,
          lastUsedAt: "2024-01-01T00:00:00Z",
        },
      },
      loading: false,
      error: null,
    });
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Distilled Skill")).toBeDefined();
    expect(screen.getByText("my-skill")).toBeDefined();
  });

  it("renders the ChatPanel regardless of run state", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "Done" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Chat with Agent")).toBeDefined();
  });

  it("renders the AgentOutputPanel when there is an active process", () => {
    mockUseActiveProcesses.mockReturnValue({
      processes: [
        {
          id: "p1",
          pid: 1,
          command: "claude",
          runId: "run-1",
          stage: "Implementing",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          elapsedMs: 0,
        },
      ],
      output: "",
    });
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("claude-code")).toBeDefined();
  });

  it("does not render the ActionBar's action buttons for a terminal Done state", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "Done" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole("button", { name: /approve plan/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
  });
});
