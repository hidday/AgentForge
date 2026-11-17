import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  WorkflowStepper: () => <div data-testid="workflow-stepper" />,
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
  ActionBar: () => <div data-testid="action-bar" />,
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: { id: string }[] }) => (
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
    id: "run-1234567",
    linearIssueId: "lin-issue-id",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
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

function renderPage(id = "run-1234567") {
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
    useRunSkillsMock.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    useActiveProcessesMock.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows an error message when the hook reports an error", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "boom",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows 'Run not found' when there is no error but also no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details and child panels once loaded", () => {
    const run = makeRun();
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [{ id: "e1" }] as unknown as RunEventRecord[] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("test-repo")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
    // No branchName/prNumber -> none of the optional links render
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("falls back to the issue identifier, then the issue id, when there is no title", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: "LIN-42" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("LIN-42")).toBeDefined();
  });

  it("renders branch, PR, Cursor and Claude links when branchName/workingDirectory/prNumber are present", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ branchName: "ai/run-1", workingDirectory: "/tmp/work", prNumber: 42 }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("ai/run-1")).toBeDefined();
    expect(screen.getByTitle("Open PR on GitHub")).toHaveProperty(
      "href",
      "https://github.com/test-repo/pull/42",
    );
    expect(screen.getByTitle("Open in Cursor")).toHaveProperty(
      "href",
      "cursor://file/tmp/work",
    );
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });

  it("renders the Linear link when linearIssueUrl is present", () => {
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
    renderPage();
    expect(screen.getByTitle("Open in Linear")).toHaveProperty(
      "href",
      "https://linear.app/issue/LIN-1",
    );
  });

  it("shows the required OpenQuestionsPanel in HumanClarificationNeeded state with open questions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "What?", requiredForExecution: true },
          { id: "q2", question: "Why?", requiredForExecution: false },
        ],
      },
      rawText: "{}",
      createdAt: "2024-01-01T00:00:00Z",
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
    // All open questions (both required and optional) shown in this state
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2");
  });

  it("shows only optional open questions in AwaitingPlanApproval state", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "What?", requiredForExecution: true },
          { id: "q2", question: "Why?", requiredForExecution: false },
        ],
      },
      rawText: "{}",
      createdAt: "2024-01-01T00:00:00Z",
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
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1");
  });

  it("renders no OpenQuestionsPanel when there is no Plan artifact or no open questions", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ state: "AwaitingPlanApproval" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });
});
