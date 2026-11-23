import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: (id: string) => useRunMock(id) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: (id: string) => useRunSkillsMock(id) }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
}));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <span data-testid="state-badge">{state}</span>,
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
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

type ActionBarProps = {
  state: string;
  hasOptionalQuestions: boolean;
  onScrollToQuestions: () => void;
  onAction: () => void;
};
let latestActionBarProps: ActionBarProps | null = null;
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: ActionBarProps) => {
    latestActionBarProps = props;
    return (
      <div data-testid="action-bar">
        <button onClick={props.onScrollToQuestions}>scroll-to-questions</button>
      </div>
    );
  },
}));

type OpenQuestionsPanelProps = {
  questions: { id: string; question: string; requiredForExecution: boolean }[];
  readOnly: boolean;
};
const openQuestionsRenders: OpenQuestionsPanelProps[] = [];
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: OpenQuestionsPanelProps) => {
    openQuestionsRenders.push(props);
    return <div data-testid="open-questions-panel">{props.questions.length}</div>;
  },
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-abcdef1234",
    linearIssueId: "issue-abcdef12",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/team/issue/ENG-42",
    repo: "org/repo",
    branchName: "feature/foo",
    prNumber: 7,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-abcdef1234"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openQuestionsRenders.length = 0;
    latestActionBarProps = null;
    useRunSkillsMock.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    useActiveProcessesMock.mockReturnValue({ processes: [], output: "" });
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("shows the error message when the fetch failed", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "boom",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows 'Run not found' when there is no error but no data either", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/run not found/i)).toBeDefined();
  });

  it("renders run header details: id, issue link, repo, branch, PR link, and editor links", () => {
    const run = makeRun({});
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText(run.id.slice(0, 8))).toBeDefined();
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByRole("link", { name: /linear/i })).toHaveProperty(
      "href",
      run.linearIssueUrl,
    );
    expect(screen.getByText(run.repo)).toBeDefined();
    expect(screen.getByText(run.branchName!)).toBeDefined();
    expect(screen.getByRole("link", { name: /pr #7/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /cursor/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /claude code/i })).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
  });

  it("falls back to the Linear identifier, then issue id, when no issue title is set", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueUrl: null });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("ENG-42")).toBeDefined();
    expect(screen.queryByRole("link", { name: /linear/i })).toBeNull();
  });

  it("falls back to the sliced issue id when neither title nor identifier is set", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueUrl: null,
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(run.linearIssueId.slice(0, 8))).toBeDefined();
  });

  it("does not render branch/PR/editor links when branchName or workingDirectory is missing", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole("link", { name: /cursor/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /pr #/i })).toBeNull();
  });

  it("shows the required OpenQuestionsPanel prominently when state is HumanClarificationNeeded", () => {
    const questions = [
      { id: "q1", question: "Which env?", requiredForExecution: true },
      { id: "q2", question: "Optional detail?", requiredForExecution: false },
    ];
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: { openQuestions: questions },
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    // All open questions (required + optional) are shown for this state.
    expect(openQuestionsRenders).toHaveLength(1);
    expect(openQuestionsRenders[0].questions).toHaveLength(2);
    expect(openQuestionsRenders[0].readOnly).toBe(false);
    expect(latestActionBarProps?.hasOptionalQuestions).toBe(true);
  });

  it("shows only optional questions in a secondary panel when state is AwaitingPlanApproval", () => {
    const questions = [
      { id: "q1", question: "Required one", requiredForExecution: true },
      { id: "q2", question: "Optional one", requiredForExecution: false },
    ];
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: { openQuestions: questions },
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(openQuestionsRenders).toHaveLength(1);
    expect(openQuestionsRenders[0].questions).toHaveLength(1);
    expect(openQuestionsRenders[0].questions[0].id).toBe("q2");
  });

  it("does not render any OpenQuestionsPanel for states without open questions", () => {
    const run = makeRun({ state: "Implementing" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(latestActionBarProps?.hasOptionalQuestions).toBe(false);
  });

  it("scrolls the questions panel into view when the ActionBar requests it", async () => {
    const scrollSpy = vi.fn();
    // jsdom does not implement scrollIntoView.
    HTMLElement.prototype.scrollIntoView = scrollSpy;

    const questions = [{ id: "q1", question: "Which env?", requiredForExecution: true }];
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: { openQuestions: questions },
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await userEvent.click(screen.getByText("scroll-to-questions"));
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("passes artifacts and events through to ArtifactTabs and EventTimeline", () => {
    const run = makeRun({});
    const artifacts: Artifact[] = [
      { id: "a1", runId: run.id, type: "Plan", version: 1, payloadJson: {}, rawText: "", createdAt: "2026-01-01T00:00:00Z" },
    ];
    const events: RunEventRecord[] = [
      { id: "e1", runId: run.id, eventType: "state-changed", source: "system", payloadJson: {}, createdAt: "2026-01-01T00:00:00Z" },
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
  });
});
