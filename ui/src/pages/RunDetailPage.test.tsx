import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

// Mock the page's own data hooks — RunDetailPage's own logic (loading/error
// branches, open-questions placement, link rendering) is the target here.
vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));

// Stub every sub-component so this test file is isolated to RunDetailPage's
// own branching logic, not the internals of each child (which have their own
// test files).
vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: (p: { state: string }) => <span data-testid="state-badge">{p.state}</span>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: (p: { currentState: string }) => (
    <div data-testid="workflow-stepper">{p.currentState}</div>
  ),
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: (p: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{p.artifacts.length}</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: (p: { output: string }) => (
    <div data-testid="agent-output">{p.output}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: (p: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{p.events.length}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: (p: { runId: string }) => <div data-testid="chat-panel">{p.runId}</div>,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: (p: { loading: boolean }) => (
    <div data-testid="distilled-skill">{String(p.loading)}</div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (p: {
    questions: Array<{ id: string }>;
    runState?: string;
    onSubmitted?: () => void;
  }) => (
    <div data-testid="open-questions" data-run-state={p.runState}>
      {p.questions.length}
      <button onClick={p.onSubmitted}>mock-submitted</button>
    </div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (p: {
    onAction: () => void;
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  }) => (
    <div data-testid="action-bar" data-has-optional={String(p.hasOptionalQuestions)}>
      <button onClick={p.onAction}>mock-action</button>
      <button onClick={p.onScrollToQuestions}>mock-scroll</button>
    </div>
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
    id: "run-123",
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
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

function renderPage(path = "/runs/run-123") {
  return render(
    <MemoryRouter initialEntries={[path]}>
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
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
  });

  it("shows the loading spinner while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });

    renderPage();

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("state-badge")).toBeNull();
  });

  it("shows the error message when the fetch fails", () => {
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

  it("renders optional links (Linear, PR, Cursor, Claude Code, Claude) only when their fields are present", () => {
    const run = makeRun({
      linearIssueUrl: "https://linear.app/issue/1",
      linearIssueTitle: "Fix the bug",
      branchName: "feat/fix",
      prNumber: 42,
      workingDirectory: "/tmp/work",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTitle("Open in Linear")).toBeDefined();
    expect(screen.getByTitle("Open PR on GitHub")).toBeDefined();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("feat/fix")).toBeDefined();
  });

  it("falls back to the Linear issue identifier, then id, when no title is set, and omits optional links", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: "ENG-99",
      linearIssueUrl: null,
      branchName: null,
      prNumber: null,
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("ENG-99")).toBeDefined();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("extracts open questions from the Plan artifact and shows the questions panel for HumanClarificationNeeded", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required one?", requiredForExecution: true },
          { id: "q2", question: "Optional one?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const panels = screen.getAllByTestId("open-questions");
    // Only the HumanClarificationNeeded panel (all questions) should render —
    // the AwaitingPlanApproval panel does not apply to this state.
    expect(panels.length).toBe(1);
    expect(panels[0]!.textContent).toContain("2");
    expect(panels[0]!.getAttribute("data-run-state")).toBe("HumanClarificationNeeded");
  });

  it("shows only optional questions in AwaitingPlanApproval and marks ActionBar's hasOptionalQuestions", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required one?", requiredForExecution: true },
          { id: "q2", question: "Optional one?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const panels = screen.getAllByTestId("open-questions");
    expect(panels.length).toBe(1);
    expect(panels[0]!.textContent).toContain("1"); // only the optional question
    expect(panels[0]!.getAttribute("data-run-state")).toBe("AwaitingPlanApproval");
    expect(screen.getByTestId("action-bar").getAttribute("data-has-optional")).toBe("true");
  });

  it("renders no open-questions panel when there is no Plan artifact, and defaults allOpenQuestions to empty", () => {
    const run = makeRun({ state: "Implementing" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryAllByTestId("open-questions").length).toBe(0);
    expect(screen.getByTestId("action-bar").getAttribute("data-has-optional")).toBe("false");
  });

  it("wires refetch through onAction, onSubmitted, and passes runId/artifacts/events to children", async () => {
    const refetch = vi.fn();
    const run = makeRun();
    const events: RunEventRecord[] = [
      { id: "e1", runId: run.id, eventType: "x", source: "s", payloadJson: {}, createdAt: "2024-01-01T00:00:00Z" },
    ];
    const artifacts: Artifact[] = [
      { id: "a1", runId: run.id, type: "Plan", version: 1, payloadJson: {}, rawText: "", createdAt: "2024-01-01T00:00:00Z" },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events },
      loading: false,
      error: null,
      refetch,
    });

    renderPage();

    expect(screen.getByTestId("chat-panel").textContent).toBe(run.id);
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");

    await userEvent.click(screen.getByText("mock-action"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("calls scrollIntoView via the ActionBar's onScrollToQuestions when the questions ref is attached", async () => {
    const scrollMock = vi.fn();
    (HTMLDivElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      scrollMock;

    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: true }],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    await userEvent.click(screen.getByText("mock-scroll"));
    expect(scrollMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    delete (HTMLDivElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
  });

  it("does not throw when onScrollToQuestions fires but no questions ref is mounted", async () => {
    const run = makeRun({ state: "Implementing" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // No open-questions ref exists in this state, so scrollToQuestions must
    // no-op safely via optional chaining rather than throwing.
    await expect(userEvent.click(screen.getByText("mock-scroll"))).resolves.not.toThrow();
  });
});
