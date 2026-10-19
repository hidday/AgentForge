import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: (id: string) => useRunMock(id) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: (id: string) => useRunSkillsMock(id) }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
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
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: OpenQuestion[] }) => (
    <div data-testid="open-questions-panel">{questions.map((q) => q.id).join(",")}</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    onScrollToQuestions,
    hasOptionalQuestions,
  }: {
    onScrollToQuestions: () => void;
    hasOptionalQuestions: boolean;
  }) => (
    <div data-testid="action-bar">
      <span data-testid="has-optional">{String(hasOptionalQuestions)}</span>
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-123456789",
    linearIssueId: "issue-abcdefgh",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-123456789"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function defaultHookReturns(overrides: {
  data?: { run: Run; artifacts: Artifact[]; events: RunEventRecord[] } | null;
  loading?: boolean;
  error?: string | null;
} = {}) {
  useRunMock.mockReturnValue({
    data: overrides.data ?? { run: makeRun(), artifacts: [], events: [] },
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    refetch: vi.fn(),
  });
  useRunSkillsMock.mockReturnValue({ data: null, loading: false, error: null });
  useActiveProcessesMock.mockReturnValue({ processes: [], output: "" });
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    useRunSkillsMock.mockReturnValue({ data: null, loading: false, error: null });
    useActiveProcessesMock.mockReturnValue({ processes: [], output: "" });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows an error message when the run fetch fails", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: "Not found", refetch: vi.fn() });
    useRunSkillsMock.mockReturnValue({ data: null, loading: false, error: null });
    useActiveProcessesMock.mockReturnValue({ processes: [], output: "" });
    renderPage();
    expect(screen.getByText("Not found")).toBeDefined();
  });

  it("shows a generic 'Run not found' message when there is no error but also no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    useRunSkillsMock.mockReturnValue({ data: null, loading: false, error: null });
    useActiveProcessesMock.mockReturnValue({ processes: [], output: "" });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run id, repo, and falls back through the issue title/identifier/id chain", () => {
    defaultHookReturns({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: null }),
        artifacts: [],
        events: [],
      },
    });
    renderPage();

    expect(screen.getByText("run-1234")).toBeDefined();
    expect(screen.getByText("issue-ab")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
  });

  it("prefers the Linear issue title when present and shows the Linear link", () => {
    defaultHookReturns({
      data: {
        run: makeRun({
          linearIssueTitle: "Fix the thing",
          linearIssueUrl: "https://linear.app/x",
        }),
        artifacts: [],
        events: [],
      },
    });
    renderPage();

    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByRole("link", { name: /Linear/i })).toBeDefined();
  });

  it("shows branch, PR, Cursor, and Claude links only when branchName and workingDirectory are set", () => {
    defaultHookReturns({
      data: {
        run: makeRun({
          branchName: "feature/x",
          workingDirectory: "/work/dir",
          prNumber: 7,
        }),
        artifacts: [],
        events: [],
      },
    });
    renderPage();

    expect(screen.getByText("feature/x")).toBeDefined();
    expect(screen.getByRole("link", { name: /PR #7/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /Cursor/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /Claude Code/i })).toBeDefined();
    expect(screen.getByRole("link", { name: "Claude" })).toBeDefined();
  });

  it("omits branch/editor links when branchName is absent", () => {
    defaultHookReturns({
      data: { run: makeRun({ branchName: null }), artifacts: [], events: [] },
    });
    renderPage();

    expect(screen.queryByRole("link", { name: /Cursor/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Claude Code/i })).toBeNull();
  });

  it("renders the open questions panel for HumanClarificationNeeded with all open questions", () => {
    const openQuestions: OpenQuestion[] = [
      { id: "q1", question: "Required?", requiredForExecution: true },
      { id: "q2", question: "Optional?", requiredForExecution: false },
    ];
    defaultHookReturns({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [{
          id: "a1",
          runId: "run-123456789",
          type: "Plan",
          version: 1,
          payloadJson: { openQuestions },
          rawText: "",
          createdAt: "2024-01-01T00:00:00Z",
        }],
        events: [],
      },
    });
    renderPage();

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("q1,q2");
    // hasOptionalQuestions reflects optionalQuestions.length regardless of state.
    expect(screen.getByTestId("has-optional").textContent).toBe("true");
  });

  it("renders only optional open questions for AwaitingPlanApproval and flags hasOptionalQuestions", () => {
    const openQuestions: OpenQuestion[] = [
      { id: "q1", question: "Required?", requiredForExecution: true },
      { id: "q2", question: "Optional?", requiredForExecution: false },
    ];
    defaultHookReturns({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [{
          id: "a1",
          runId: "run-123456789",
          type: "Plan",
          version: 1,
          payloadJson: { openQuestions },
          rawText: "",
          createdAt: "2024-01-01T00:00:00Z",
        }],
        events: [],
      },
    });
    renderPage();

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("q2");
    expect(screen.getByTestId("has-optional").textContent).toBe("true");
  });

  it("does not render an open questions panel when there is no Plan artifact", () => {
    defaultHookReturns({
      data: { run: makeRun({ state: "HumanClarificationNeeded" }), artifacts: [], events: [] },
    });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("scrolls the questions panel into view when the action bar requests it", async () => {
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    defaultHookReturns({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [{
          id: "a1",
          runId: "run-123456789",
          type: "Plan",
          version: 1,
          payloadJson: { openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: true }] },
          rawText: "",
          createdAt: "2024-01-01T00:00:00Z",
        }],
        events: [],
      },
    });
    renderPage();

    await userEvent.click(screen.getByText("scroll-to-questions"));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("passes artifacts and events through to ArtifactTabs and EventTimeline", () => {
    defaultHookReturns({
      data: {
        run: makeRun(),
        artifacts: [{
          id: "a1",
          runId: "run-123456789",
          type: "Plan",
          version: 1,
          payloadJson: {},
          rawText: "",
          createdAt: "2024-01-01T00:00:00Z",
        }],
        events: [{
          id: "e1",
          runId: "run-123456789",
          eventType: "run:state-changed",
          source: "system",
          payloadJson: {},
          createdAt: "2024-01-01T00:00:00Z",
        }],
      },
    });
    renderPage();

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
    expect(screen.getByTestId("workflow-stepper").textContent).toBe("Implementing");
  });
});
