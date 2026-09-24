import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

// ---------------------------------------------------------------------------
// Hook mocks
// ---------------------------------------------------------------------------
vi.mock("@/hooks/useRun.ts", () => ({
  useRun: vi.fn(),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: vi.fn(),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Child component mocks — keep the test focused on RunDetailPage's own logic
// ---------------------------------------------------------------------------
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
    <div data-testid="artifact-tabs">{artifacts.length} artifacts</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: ({ output }: { output: string }) => (
    <div data-testid="agent-output-panel">{output}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length} events</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    onScrollToQuestions,
    onAction,
    hasOptionalQuestions,
  }: {
    onScrollToQuestions?: () => void;
    onAction: () => void;
    hasOptionalQuestions?: boolean;
  }) => (
    <div data-testid="action-bar">
      <span data-testid="has-optional-questions">{String(!!hasOptionalQuestions)}</span>
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
      <button onClick={onAction}>action-bar-action</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({
    questions,
  }: {
    questions: { id: string; question: string }[];
  }) => (
    <div data-testid="open-questions-panel">
      {questions.map((q) => (
        <div key={q.id}>{q.question}</div>
      ))}
    </div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: ({ runId }: { runId: string }) => (
    <div data-testid="chat-panel">chat-for-{runId}</div>
  ),
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: ({ loading }: { loading?: boolean }) => (
    <div data-testid="distilled-skill-panel">{loading ? "loading" : "loaded"}</div>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";
import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-abcdef123456",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage(id = "run-abcdef123456") {
  return render(
    <MemoryRouter initialEntries={[`/runs/${id}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const defaultSkills = {
  data: null,
  loading: false,
  error: null,
};

const defaultProcesses = {
  processes: [],
  hasActive: false,
  output: "",
  activeProcessId: null,
};

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRunSkills.mockReturnValue(defaultSkills);
    mockUseActiveProcesses.mockReturnValue(defaultProcesses);
  });

  it("shows the loading state while the run is being fetched", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });

    renderPage();

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("workflow-stepper")).toBeNull();
  });

  it("shows an error message when the hook surfaces an error", () => {
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

  it("renders full run detail content on successful load", () => {
    const run = makeRun({
      linearIssueTitle: "Add feature X",
      linearIssueUrl: "https://linear.app/issue/1",
      repo: "acme/repo",
      branchName: "feature/x",
      prNumber: 42,
      workingDirectory: "/home/work/x",
      state: "Implementing",
    });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {},
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: run.id,
        eventType: "RUN_REQUESTED",
        source: "system",
        payloadJson: {},
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    mockUseRun.mockReturnValue({
      data: { run, artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage(run.id);

    // Header content
    expect(screen.getByText("Run Detail")).toBeDefined();
    expect(screen.getByText(run.id.slice(0, 8))).toBeDefined();
    expect(screen.getByText("Add feature X")).toBeDefined();
    expect(screen.getByText("acme/repo")).toBeDefined();
    expect(screen.getByText("feature/x")).toBeDefined();
    expect(screen.getByRole("link", { name: /pr #42/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /linear/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /cursor/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /claude code/i })).toBeDefined();

    // Child panels received the right data
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTestId("workflow-stepper").textContent).toBe("Implementing");
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1 artifacts");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1 events");
    expect(screen.getByTestId("chat-panel").textContent).toBe(`chat-for-${run.id}`);
    expect(screen.getByTestId("action-bar")).toBeDefined();
  });

  it("falls back to linearIssueIdentifier / linearIssueId when no title is present, and omits optional links", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: "ENG-99",
      linearIssueUrl: null,
      branchName: null,
      prNumber: null,
      workingDirectory: "",
    });

    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage(run.id);

    expect(screen.getByText("ENG-99")).toBeDefined();
    expect(screen.queryByRole("link", { name: /linear/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^pr #/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /cursor/i })).toBeNull();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("falls back to a truncated linearIssueId when both title and identifier are absent", () => {
    const run = makeRun({
      linearIssueId: "abcdefgh-1234-5678",
      linearIssueTitle: null,
      linearIssueIdentifier: null,
    });

    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage(run.id);

    expect(screen.getByText(run.linearIssueId.slice(0, 8))).toBeDefined();
  });

  it("shows the open questions panel for HumanClarificationNeeded runs with open questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts: Artifact[] = [
      {
        id: "plan-1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Which environment?", requiredForExecution: true },
            { id: "q2", question: "Any perf constraints?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage(run.id);

    // Both required and optional questions show up in the prominent panel
    // for HumanClarificationNeeded (all open questions, not just optional)
    expect(screen.getByText("Which environment?")).toBeDefined();
    expect(screen.getByText("Any perf constraints?")).toBeDefined();
  });

  it("shows only optional questions in AwaitingPlanApproval and wires up ActionBar's scroll-to-questions", () => {
    const scrollIntoViewMock = vi.fn();
    // jsdom does not implement scrollIntoView; stub it for this test.
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts: Artifact[] = [
      {
        id: "plan-1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Required one", requiredForExecution: true },
            { id: "q2", question: "Optional one", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage(run.id);

    // Only the optional question is shown (secondary collapsible panel)
    expect(screen.getByText("Optional one")).toBeDefined();
    expect(screen.queryByText("Required one")).toBeNull();
    expect(screen.getByTestId("has-optional-questions").textContent).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "scroll-to-questions" }));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("passes loading/error state from useRunSkills through to DistilledSkillPanel", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRunSkills.mockReturnValue({ data: null, loading: true, error: null });

    renderPage(run.id);

    expect(screen.getByTestId("distilled-skill-panel").textContent).toBe("loading");
  });

  it("passes active process output through to AgentOutputPanel", () => {
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
      output: "some agent output",
      activeProcessId: null,
    });

    renderPage(run.id);

    expect(screen.getByTestId("agent-output-panel").textContent).toBe("some agent output");
  });

  it("triggers refetch when ActionBar reports an action", () => {
    const run = makeRun();
    const refetch = vi.fn();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });

    renderPage(run.id);

    fireEvent.click(screen.getByRole("button", { name: "action-bar-action" }));
    expect(refetch).toHaveBeenCalled();
  });
});
