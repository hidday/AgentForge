import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (...args: unknown[]) => useRunMock(...args),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (...args: unknown[]) => useRunSkillsMock(...args),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (...args: unknown[]) => useActiveProcessesMock(...args),
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
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length}</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    state,
    onScrollToQuestions,
  }: {
    state: string;
    onScrollToQuestions?: () => void;
  }) => (
    <div data-testid="action-bar">
      {state}
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: unknown[] }) => (
    <div data-testid="open-questions-panel">{questions.length}</div>
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
    id: "run-abcdefgh-1234",
    linearIssueId: "issue-12345678",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
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
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderAt(id: string) {
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
    useRunMock.mockReset();
    useRunSkillsMock.mockReset();
    useActiveProcessesMock.mockReset();
    useRunSkillsMock.mockReturnValue({ data: null, loading: false, error: null });
    useActiveProcessesMock.mockReturnValue({ processes: [], output: "" });
  });

  it("reads the run id route param and passes it to useRun/useRunSkills/useActiveProcesses", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-xyz");

    expect(useRunMock).toHaveBeenCalledWith("run-xyz");
    expect(useRunSkillsMock).toHaveBeenCalledWith("run-xyz");
    expect(useActiveProcessesMock).toHaveBeenCalledWith("run-xyz");
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("shows an error message when the hook reports an error", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "Run fetch failed",
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByText("Run fetch failed")).toBeDefined();
  });

  it("shows a 'Run not found' message when there is no error but no data", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByText(/run not found/i)).toBeDefined();
  });

  it("renders run header details and child panels once data is loaded", () => {
    const run = makeRun();
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);

    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("acme/repo")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTestId("workflow-stepper").textContent).toBe("Implementing");
    expect(screen.getByTestId("action-bar").textContent).toContain("Implementing");
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
  });

  it("falls back to the Linear issue identifier, then the issue id, when there is no title", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when title and identifier are both absent", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "issue-12345678",
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);
    expect(screen.getByText("issue-12")).toBeDefined();
  });

  it("renders the Linear link when linearIssueUrl is present", () => {
    const run = makeRun({ linearIssueUrl: "https://linear.app/issue/ENG-42" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/ENG-42");
  });

  it("renders branch, PR, Cursor and Claude links when branchName/workingDirectory/prNumber are set", () => {
    const run = makeRun({
      branchName: "feature/foo",
      prNumber: 7,
      workingDirectory: "/work/foo",
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);

    expect(screen.getByText("feature/foo")).toBeDefined();
    expect(screen.getByTitle("Open PR on GitHub").getAttribute("href")).toBe(
      "https://github.com/acme/repo/pull/7",
    );
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });

  it("does not render branch/PR/editor links when branchName and prNumber are absent", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);

    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("shows the OpenQuestionsPanel with all open questions when state is HumanClarificationNeeded", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Q1?", requiredForExecution: true },
          { id: "q2", question: "Q2?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);

    // Both required and optional questions show in HumanClarificationNeeded
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2");
  });

  it("shows only optional questions in a secondary panel when state is AwaitingPlanApproval", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Q1?", requiredForExecution: true },
          { id: "q2", question: "Q2?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1");
  });

  it("does not render any OpenQuestionsPanel when there is no Plan artifact", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("passes artifacts and events through to ArtifactTabs and EventTimeline", () => {
    const run = makeRun();
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
        eventType: "run:created",
        source: "system",
        payloadJson: {},
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
  });

  it("scrolls the open questions panel into view when the ActionBar requests it", () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = (
      HTMLElement.prototype as unknown as { scrollIntoView?: () => void }
    ).scrollIntoView;
    (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      scrollIntoViewMock;

    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Q1?", requiredForExecution: true }],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);

    fireEvent.click(screen.getByRole("button", { name: "scroll-to-questions" }));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView =
      originalScrollIntoView;
  });

  it("does nothing when the ActionBar requests a scroll and there is no questions panel ref", () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = (
      HTMLElement.prototype as unknown as { scrollIntoView?: () => void }
    ).scrollIntoView;
    (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      scrollIntoViewMock;

    // No Plan artifact / no open questions -> questionsRef never attached to a DOM node.
    const run = makeRun({ state: "Implementing" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt(run.id);

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "scroll-to-questions" })),
    ).not.toThrow();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView =
      originalScrollIntoView;
  });
});
