import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";

const mockUseRun = vi.fn();
const mockUseRunSkills = vi.fn();
const mockUseActiveProcesses = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: (id: string) => mockUseRun(id) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => mockUseRunSkills(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => mockUseActiveProcesses(id),
}));

vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: (props: { currentState: string }) => (
    <div data-testid="workflow-stepper">{props.currentState}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: (props: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{props.events.length} events</div>
  ),
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: (props: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{props.artifacts.length} artifacts</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: {
    state: string;
    hasOptionalQuestions?: boolean;
    onAction: () => void;
    onScrollToQuestions?: () => void;
  }) => (
    <div data-testid="action-bar">
      <span>state:{props.state}</span>
      <span>optional:{String(props.hasOptionalQuestions)}</span>
      <button onClick={props.onAction}>Trigger Action</button>
      <button onClick={props.onScrollToQuestions}>Scroll To Questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: { questions: OpenQuestion[]; readOnly: boolean }) => (
    <div data-testid="open-questions-panel">
      {props.questions.length} questions (readOnly={String(props.readOnly)})
    </div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> & Pick<Run, "state">): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the login bug",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
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

function setUseRun(data: { run: Run; artifacts: Artifact[]; events: RunEventRecord[] } | null, extra: Partial<{ loading: boolean; error: string | null; refetch: () => void }> = {}) {
  mockUseRun.mockReturnValue({
    data,
    loading: false,
    error: null,
    refetch: vi.fn(),
    ...extra,
  });
}

function renderPage(initialRoute = "/runs/run-1") {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: false,
      error: null,
    });
    mockUseActiveProcesses.mockReturnValue({ processes: [], output: "" });
  });

  it("shows a loading state while the run is being fetched", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
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

  it("shows a fallback message when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Run not found/i)).toBeDefined();
  });

  it("renders run header details: id, issue title, repo, and state", () => {
    const run = makeRun({ state: "Implementing" });
    setUseRun({ run, artifacts: [], events: [] });
    renderPage();

    expect(screen.getByText("run-1".slice(0, 8))).toBeDefined();
    expect(screen.getByText("Fix the login bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByTestId("workflow-stepper").textContent).toBe("Implementing");
  });

  it("passes artifacts and events through to ArtifactTabs and EventTimeline", () => {
    const run = makeRun({ state: "Implementing" });
    const artifacts: Artifact[] = [
      { id: "a1", runId: "run-1", type: "Plan", version: 1, payloadJson: {}, rawText: "", createdAt: "2024-01-01T00:00:00Z" },
    ];
    const events: RunEventRecord[] = [
      { id: "e1", runId: "run-1", eventType: "RUN_REQUESTED", source: "human", payloadJson: null, createdAt: "2024-01-01T00:00:00Z" },
    ];
    setUseRun({ run, artifacts, events });
    renderPage();

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1 artifacts");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1 events");
  });

  it("shows the OpenQuestionsPanel with all open questions (not read-only) when state is HumanClarificationNeeded", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required?", requiredForExecution: true },
      { id: "q2", question: "Optional?", requiredForExecution: false },
    ];
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts: Artifact[] = [
      {
        id: "plan-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { openQuestions: questions },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    setUseRun({ run, artifacts, events: [] });
    renderPage();

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.textContent).toBe("2 questions (readOnly=false)");
  });

  it("shows only optional open questions in AwaitingPlanApproval state, and passes hasOptionalQuestions to ActionBar", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required?", requiredForExecution: true },
      { id: "q2", question: "Optional?", requiredForExecution: false },
    ];
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts: Artifact[] = [
      {
        id: "plan-1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { openQuestions: questions },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    setUseRun({ run, artifacts, events: [] });
    renderPage();

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.textContent).toBe("1 questions (readOnly=false)");

    const actionBar = screen.getByTestId("action-bar");
    expect(actionBar.textContent).toContain("state:AwaitingPlanApproval");
    expect(actionBar.textContent).toContain("optional:true");
  });

  it("does not render the OpenQuestionsPanel for states with no relevant open questions", () => {
    const run = makeRun({ state: "Implementing" });
    setUseRun({ run, artifacts: [], events: [] });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("calls refetch when the ActionBar triggers onAction", async () => {
    const refetch = vi.fn();
    const run = makeRun({ state: "Implementing" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    const { default: userEvent } = await import("@testing-library/user-event");
    renderPage();

    await userEvent.click(screen.getByText("Trigger Action"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("renders a PR link when the run has a prNumber", () => {
    const run = makeRun({ state: "Implementing", prNumber: 7, repo: "org/repo" });
    setUseRun({ run, artifacts: [], events: [] });
    renderPage();

    const prLink = screen.getByTitle("Open PR on GitHub");
    expect(prLink.getAttribute("href")).toBe("https://github.com/org/repo/pull/7");
    expect(screen.getByText("PR #7")).toBeDefined();
  });

  it("does not render a PR link when the run has no prNumber", () => {
    const run = makeRun({ state: "Implementing", prNumber: null });
    setUseRun({ run, artifacts: [], events: [] });
    renderPage();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
  });

  it("renders branch, Linear, Cursor, and Claude links when branchName and workingDirectory are set", () => {
    const run = makeRun({
      state: "Implementing",
      branchName: "feature/login-fix",
      workingDirectory: "/repos/org/repo",
      linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    });
    setUseRun({ run, artifacts: [], events: [] });
    renderPage();

    expect(screen.getByText("feature/login-fix")).toBeDefined();
    expect(screen.getByTitle("Open in Linear").getAttribute("href")).toBe(
      "https://linear.app/team/issue/ENG-1",
    );
    expect(screen.getByTitle("Open in Cursor").getAttribute("href")).toBe(
      "cursor://file/repos/org/repo",
    );
    expect(
      screen.getByTitle("Open Claude Code session in this run's worktree"),
    ).toBeDefined();
    expect(
      screen.getByTitle("Open Claude Desktop (Code) in this run's worktree"),
    ).toBeDefined();
  });

  it("does not render branch/Cursor/Claude links when branchName is absent", () => {
    const run = makeRun({ state: "Implementing", branchName: null });
    setUseRun({ run, artifacts: [], events: [] });
    renderPage();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });
});
