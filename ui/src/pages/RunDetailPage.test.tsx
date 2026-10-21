import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (id: string) => useRunMock(id),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => useRunSkillsMock(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
}));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: (props: { state: string }) => <span data-testid="state-badge">{props.state}</span>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: () => <div data-testid="workflow-stepper" />,
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: (props: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{props.artifacts.length} artifacts</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: (props: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{props.events.length} events</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: {
    runId: string;
    state: string;
    hasOptionalQuestions: boolean;
    onScrollToQuestions: () => void;
  }) => (
    <div data-testid="action-bar">
      <span>{props.state}</span>
      <span>{props.hasOptionalQuestions ? "has-optional" : "no-optional"}</span>
      <button onClick={props.onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: { questions: OpenQuestion[] }) => (
    <div data-testid="open-questions-panel">{props.questions.length} questions</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderAtRunId(id = "run-1") {
  return render(
    <MemoryRouter initialEntries={[`/runs/${id}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function defaultSkills() {
  return { data: null, loading: false, error: null };
}

function defaultProcesses() {
  return { processes: [], hasActive: false, output: "", activeProcessId: null };
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    useRunMock.mockReset();
    useRunSkillsMock.mockReset();
    useActiveProcessesMock.mockReset();
    useRunSkillsMock.mockReturnValue(defaultSkills());
    useActiveProcessesMock.mockReturnValue(defaultProcesses());
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderAtRunId();
    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows an error message when the run failed to load", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "boom",
      refetch: vi.fn(),
    });
    renderAtRunId();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows a not-found message when there is no error but also no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderAtRunId();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the full layout once the run has loaded", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId();
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Todo");
    // Neither open-questions panel renders for a plain Todo run.
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("shows the required open-questions panel when HumanClarificationNeeded with open questions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "{}",
      createdAt: "2026-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId();
    // Both questions (required + optional) are shown in the prominent panel.
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2 questions");
    // hasOptionalQuestions is still computed from the optional-only list.
    expect(screen.getByText("has-optional")).toBeDefined();
  });

  it("shows only optional open questions in AwaitingPlanApproval state", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "{}",
      createdAt: "2026-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId();
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1 questions");
    expect(screen.getByText("has-optional")).toBeDefined();
  });

  it("does not show the optional-questions panel in AwaitingPlanApproval when there are none", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByText("no-optional")).toBeDefined();
  });

  it("renders the Linear issue link when a linearIssueUrl is present", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ linearIssueUrl: "https://linear.app/issue/LIN-1" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId();
    const link = screen.getByTitle("Open in Linear") as HTMLAnchorElement;
    expect(link.href).toBe("https://linear.app/issue/LIN-1");
  });

  it("renders the PR link when a prNumber is set", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ prNumber: 42, repo: "acme/widgets" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId();
    const link = screen.getByTitle("Open PR on GitHub") as HTMLAnchorElement;
    expect(link.href).toBe("https://github.com/acme/widgets/pull/42");
  });

  it("renders branch, Cursor, Claude Code and Claude links when branch + working directory are set", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ branchName: "ai/lin-1", workingDirectory: "/repo/work" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId();
    expect(screen.getByText("ai/lin-1")).toBeDefined();
    expect((screen.getByTitle("Open in Cursor") as HTMLAnchorElement).href).toBe(
      "cursor://file/repo/work",
    );
    expect(
      (screen.getByTitle("Open Claude Code session in this run's worktree") as HTMLAnchorElement)
        .href,
    ).toContain("claude-cli://open?cwd=");
    expect(
      (screen.getByTitle("Open Claude Desktop (Code) in this run's worktree") as HTMLAnchorElement)
        .href,
    ).toContain("claude://code/new?folder=");
  });

  it("falls back from issue title to identifier to id when rendering the issue label", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueTitle: null,
          linearIssueIdentifier: "LIN-99",
          linearIssueId: "full-uuid-value",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId();
    expect(screen.getByText("LIN-99")).toBeDefined();
  });

  it("scrolls to the questions panel when the action bar requests it", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      },
      rawText: "{}",
      createdAt: "2026-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const scrollIntoViewMock = vi.fn();
    // jsdom doesn't implement scrollIntoView.
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    renderAtRunId();
    fireEvent.click(screen.getByText("scroll-to-questions"));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});
