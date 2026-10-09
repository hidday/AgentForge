import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RunDetailPage } from "./RunDetailPage";
import type { Artifact, Run, RunEventRecord } from "@/api/client.ts";

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

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <span data-testid="state-badge">{state}</span>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: () => <div data-testid="workflow-stepper" />,
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
  }: {
    onScrollToQuestions?: () => void;
    hasOptionalQuestions: boolean;
  }) => (
    <div data-testid="action-bar">
      <span data-testid="has-optional">{String(hasOptionalQuestions)}</span>
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: { id: string }[] }) => (
    <div data-testid="open-questions">{questions.length}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/runs/${id}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
    branchName: "feat/fix",
    prNumber: 42,
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
    renderAt("run-1");
    expect(screen.getByText("Loading run...")).toBeTruthy();
  });

  it("shows an error message when the run fails to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run not found",
      refetch: vi.fn(),
    });
    renderAt("run-1");
    expect(screen.getByText("Run not found")).toBeTruthy();
  });

  it("shows a fallback message when there's no error but no data either", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderAt("run-1");
    expect(screen.getByText("Run not found")).toBeTruthy();
  });

  it("renders run header details, artifacts, and events when loaded", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [{ id: "a1" }, { id: "a2" }] as Artifact[], events: [{ id: "e1" } as RunEventRecord] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt(run.id);

    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByText("Fix the thing")).toBeTruthy();
    expect(screen.getByText("org/repo")).toBeTruthy();
    expect(screen.getByText("feat/fix")).toBeTruthy();
    expect(screen.getByText("PR #42")).toBeTruthy();
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("2");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
  });

  it("shows the Linear link when linearIssueUrl is present", () => {
    const run = makeRun({ linearIssueUrl: "https://linear.app/issue/ENG-1" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt(run.id);
    const link = screen.getByText("Linear").closest("a");
    expect(link?.getAttribute("href")).toBe("https://linear.app/issue/ENG-1");
  });

  it("omits branch/PR/open-in-editor links when the run has no branch", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt(run.id);
    expect(screen.queryByText("Cursor")).toBeNull();
    expect(screen.queryByText("Claude Code")).toBeNull();
    expect(screen.queryByText(/^PR #/)).toBeNull();
  });

  it("shows the required open-questions panel prominently when HumanClarificationNeeded", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const plan: Artifact = {
      id: "plan-1",
      runId: run.id,
      type: "Plan",
      version: 1,
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [plan], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt(run.id);

    // Both required+optional questions shown (allOpenQuestions, length 2)
    expect(screen.getByTestId("open-questions").textContent).toBe("2");
    // ActionBar sees hasOptionalQuestions based on optionalQuestions (1 item -> true)
    expect(screen.getByTestId("has-optional").textContent).toBe("true");
  });

  it("shows only optional questions as a secondary panel when AwaitingPlanApproval", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const plan: Artifact = {
      id: "plan-1",
      runId: run.id,
      type: "Plan",
      version: 1,
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [plan], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt(run.id);

    // Only the 1 optional question is shown in this state.
    expect(screen.getByTestId("open-questions").textContent).toBe("1");
    expect(screen.getByTestId("has-optional").textContent).toBe("true");
  });

  it("hides the open-questions panel when there is no Plan artifact", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt(run.id);
    expect(screen.queryByTestId("open-questions")).toBeNull();
    expect(screen.getByTestId("has-optional").textContent).toBe("false");
  });

  it("scrolls the questions panel into view when the action bar requests it", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const plan: Artifact = {
      id: "plan-1",
      runId: run.id,
      type: "Plan",
      version: 1,
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      },
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [plan], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt(run.id);

    const scrollIntoViewMock = vi.fn();
    // jsdom doesn't implement scrollIntoView; stub it on the prototype.
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    fireEvent.click(screen.getByText("scroll-to-questions"));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("passes active process output through to the AgentOutputPanel", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "build output here",
      activeProcessId: null,
    });
    renderAt(run.id);
    expect(screen.getByTestId("agent-output").textContent).toBe("build output here");
  });
});
