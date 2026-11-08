import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  StateBadge: ({ state }: { state: string }) => <div data-testid="state-badge">{state}</div>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: ({ currentState }: { currentState: string }) => (
    <div data-testid="workflow-stepper">{currentState}</div>
  ),
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{artifacts.length}</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: ({ output }: { output: string }) => (
    <div data-testid="agent-output">{output}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length}</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    onScrollToQuestions,
    hasOptionalQuestions,
    onAction,
  }: {
    onScrollToQuestions: () => void;
    hasOptionalQuestions: boolean;
    onAction: () => void;
  }) => (
    <div data-testid="action-bar">
      <span data-testid="has-optional">{String(hasOptionalQuestions)}</span>
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
      <button onClick={onAction}>trigger-refetch</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: OpenQuestion[] }) => (
    <div data-testid="open-questions">{questions.length}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: ({ loading }: { loading: boolean }) => (
    <div data-testid="distilled-skill">{String(loading)}</div>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "acme/widgets",
    branchName: "fix/bug",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function defaultActiveProcesses() {
  return { processes: [], hasActive: false, output: "", activeProcessId: null };
}

function defaultSkills() {
  return { data: null, loading: false, error: null, refetch: vi.fn() };
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
    useRunSkillsMock.mockReturnValue(defaultSkills());
    useActiveProcessesMock.mockReturnValue(defaultActiveProcesses());
  });

  it("shows the loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows the error message when the hook reports an error", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "Could not load run",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Could not load run")).toBeDefined();
  });

  it("shows 'Run not found' when there is no error but also no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run header details once data has loaded", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("fix/bug")).toBeDefined();
    expect(screen.getByText("PR #42")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
  });

  it("falls back to the linear issue identifier when there is no title", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ linearIssueTitle: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated issue id when there is no title or identifier", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueTitle: null,
          linearIssueIdentifier: null,
          linearIssueId: "abcdefgh12345",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("does not render branch/PR/editor links when those fields are absent", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ branchName: null, prNumber: null, linearIssueUrl: null }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("renders editor deep links when branchName and workingDirectory are present", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(
      screen.getByTitle("Open Claude Desktop (Code) in this run's worktree"),
    ).toBeDefined();
  });

  it("shows the required open-questions panel prominently for HumanClarificationNeeded", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ] as OpenQuestion[],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00.000Z",
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
    renderPage();
    // All open questions (both required and optional) shown for this state.
    expect(screen.getByTestId("open-questions").textContent).toBe("2");
  });

  it("shows only optional questions, and reports hasOptionalQuestions, for AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ] as OpenQuestion[],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00.000Z",
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
    renderPage();
    expect(screen.getByTestId("open-questions").textContent).toBe("1");
    expect(screen.getByTestId("has-optional").textContent).toBe("true");
  });

  it("does not render any open-questions panel when there is no Plan artifact", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions")).toBeNull();
  });

  it("does not render the open-questions panel for a happy-path state like Implementing", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ state: "Implementing" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions")).toBeNull();
    expect(screen.getByTestId("has-optional").textContent).toBe("false");
  });

  it("passes artifacts and events down to ArtifactTabs and EventTimeline", () => {
    const artifacts: Artifact[] = [
      { id: "a1", runId: "run-1", type: "Plan", version: 1, payloadJson: {}, rawText: "", createdAt: "x" },
    ];
    const events: RunEventRecord[] = [
      { id: "e1", runId: "run-1", eventType: "x", source: "s", payloadJson: null, createdAt: "y" },
    ];
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
  });

  it("passes active-process output to the AgentOutputPanel", () => {
    useActiveProcessesMock.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "some log output",
      activeProcessId: null,
    });
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("agent-output").textContent).toBe("some log output");
  });

  it("forwards distilled skill loading state", () => {
    useRunSkillsMock.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("distilled-skill").textContent).toBe("true");
  });

  it("calls refetch when the ActionBar reports an action", async () => {
    const refetch = vi.fn();
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();
    await userEvent.click(screen.getByText("trigger-refetch"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("scrolls the questions ref into view when ActionBar requests it", async () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Optional?", requiredForExecution: false },
        ] as OpenQuestion[],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00.000Z",
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
    renderPage();
    const scrollSpy = vi.fn();
    // jsdom doesn't implement scrollIntoView; stub it on all elements.
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;
    await userEvent.click(screen.getByText("scroll-to-questions"));
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("renders the chat panel unconditionally", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
  });
});
