import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (id: string) => mockUseRun(id),
}));

const mockUseActiveProcesses = vi.fn();
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => mockUseActiveProcesses(id),
}));

const mockUseRunSkills = vi.fn();
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => mockUseRunSkills(id),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-abcdefgh-1234",
    linearIssueId: "issue-abcdefgh",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function setUseRun(
  run: Run,
  artifacts: Artifact[] = [],
  events: RunEventRecord[] = [],
  extra: Partial<ReturnType<typeof mockUseRun>> = {},
) {
  mockUseRun.mockReturnValue({
    data: { run, artifacts, events },
    loading: false,
    error: null,
    refetch: vi.fn(),
    ...extra,
  });
}

function renderPage(id = "run-1") {
  return render(
    <MemoryRouter initialEntries={[`/runs/${id}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows the error message when the run fails to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Network error",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("shows a 'Run not found' fallback when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details: id, issue, repo, state badge, and created date", () => {
    setUseRun(makeRun({ id: "run-abcdefgh-1234" }));
    renderPage();
    expect(screen.getByText("run-abcd")).toBeDefined();
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });

  it("falls back to the issue identifier, then a sliced id, when the title is missing", () => {
    setUseRun(makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-7" }));
    const { rerender } = renderPage();
    expect(screen.getByText("ENG-7")).toBeDefined();

    setUseRun(
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "zzzzzzzz9999",
      }),
    );
    rerender(
      <MemoryRouter initialEntries={["/runs/run-1"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("zzzzzzzz")).toBeDefined();
  });

  it("renders a Linear issue link only when linearIssueUrl is set", () => {
    setUseRun(makeRun({ linearIssueUrl: null }));
    const { rerender } = renderPage();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();

    setUseRun(makeRun({ linearIssueUrl: "https://linear.app/x" }));
    rerender(
      <MemoryRouter initialEntries={["/runs/run-1"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/x");
  });

  it("renders branch, PR, Cursor, and Claude links only when branchName and workingDirectory are set", () => {
    setUseRun(
      makeRun({
        branchName: "feature/foo",
        workingDirectory: "/repo/wd",
        prNumber: 7,
        repo: "org/repo",
      }),
    );
    renderPage();
    expect(screen.getByText("feature/foo")).toBeDefined();
    const prLink = screen.getByTitle("Open PR on GitHub");
    expect(prLink.getAttribute("href")).toBe("https://github.com/org/repo/pull/7");
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });

  it("does not render branch/PR/Cursor/Claude links when branchName is absent", () => {
    setUseRun(makeRun({ branchName: null, prNumber: null }));
    renderPage();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
  });

  it("prominently shows OpenQuestionsPanel for HumanClarificationNeeded with open questions", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Which DB?", requiredForExecution: true },
          ],
        },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    setUseRun(makeRun({ state: "HumanClarificationNeeded" }), artifacts, []);
    renderPage();
    // The question text is rendered both by the prominent OpenQuestionsPanel
    // and by the Plan tab in ArtifactTabs (same underlying Plan artifact).
    expect(screen.getAllByText("Which DB?").length).toBeGreaterThan(0);
    expect(screen.getByText("Required")).toBeDefined();
  });

  it("shows optional questions as a secondary panel for AwaitingPlanApproval", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Optional: color scheme?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    setUseRun(makeRun({ state: "AwaitingPlanApproval" }), artifacts, []);
    renderPage();
    expect(screen.getAllByText("Optional: color scheme?").length).toBeGreaterThan(0);
  });

  it("renders the workflow stepper, event timeline, artifact tabs, and chat panel", () => {
    const artifacts: Artifact[] = [
      { id: "a1", runId: "run-1", type: "Plan", version: 1, payloadJson: { summary: "Plan summary" }, rawText: "", createdAt: "2024-01-01T00:00:00Z" },
    ];
    const events: RunEventRecord[] = [
      { id: "e1", runId: "run-1", eventType: "RUN_REQUESTED", source: "system", payloadJson: null, createdAt: "2024-01-01T00:00:00Z" },
    ];
    setUseRun(makeRun({ state: "Planning" }), artifacts, events);
    renderPage();

    expect(screen.getByText("Workflow")).toBeDefined();
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Run Requested")).toBeDefined();
    expect(screen.getByText("Chat with Agent")).toBeDefined();
  });

  it("scrolls to the questions panel when the action bar's scroll button is used", async () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: false }],
        },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    setUseRun(makeRun({ state: "AwaitingPlanApproval" }), artifacts, []);
    const scrollIntoView = vi.fn();
    HTMLDivElement.prototype.scrollIntoView = scrollIntoView;

    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /Answer Optional Questions/i }));

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("passes active process output into AgentOutputPanel", () => {
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
      hasActive: true,
      output: "",
      activeProcessId: "p1",
    });
    setUseRun(makeRun({ state: "Implementing" }));
    renderPage();
    expect(screen.getByText("claude-code")).toBeDefined();
  });

  it("renders the distilled skill panel when skills data indicates persistence", () => {
    mockUseRunSkills.mockReturnValue({
      data: {
        injectedSkills: [],
        distillationDecision: {
          shouldPersist: true,
          reason: "novel",
          taskCategory: "cat",
          name: "my-skill",
          description: "desc",
          displacedSkillId: null,
        },
        distilledSkill: {
          id: "s1",
          repoSlug: "org/repo",
          name: "my-skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "# hi",
          utilityScore: 0,
          lastUsedAt: "2024-01-01T00:00:00Z",
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    setUseRun(makeRun({}));
    renderPage();
    expect(screen.getByText("Distilled Skill")).toBeDefined();
  });
});
