import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: () => <div data-testid="artifact-tabs" />,
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: unknown[] }) => (
    <div data-testid="open-questions-panel">{questions.length}</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ onScrollToQuestions }: { onScrollToQuestions: () => void }) => (
    <button onClick={onScrollToQuestions}>action-bar-scroll</button>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-123",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Todo",
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-123"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const defaultSkills = { data: null, loading: false, error: null };
const defaultProcesses = { processes: [], hasActive: false, output: "", activeProcessId: null };

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRunSkillsMock.mockReturnValue(defaultSkills);
    useActiveProcessesMock.mockReturnValue(defaultProcesses);
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

  it("shows 'Run not found' when there is no error but data is missing", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details once loaded", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({}), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
  });

  it("falls back to the issue identifier, then the issue id, for the header issue label", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueTitle: null,
          linearIssueIdentifier: "ENG-9",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("ENG-9")).toBeDefined();
  });

  it("falls back to a truncated issue id when title and identifier are both missing", () => {
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

  it("renders optional external links only when their data is present", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueUrl: "https://linear.app/issue/1",
          prNumber: 7,
          branchName: "feature/x",
          workingDirectory: "/work/x",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
    expect(screen.getByTitle("Open PR on GitHub")).toBeDefined();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
  });

  it("does not render optional links when their underlying data is absent", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({}), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("shows the open questions panel prominently for HumanClarificationNeeded with required questions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-123",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "",
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
    // Shows all open questions (both required and optional) = 2
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2");
  });

  it("shows only optional open questions for AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-123",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "",
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
    // Only the one optional question
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1");
  });

  it("does not render the open questions panel in other states", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ state: "Implementing" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("scrolls to the questions panel when the action bar requests it", async () => {
    const scrollIntoViewMock = vi.fn();
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-123",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "",
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

    // jsdom doesn't implement scrollIntoView; stub it on the ref'd element.
    const panel = screen.getByTestId("open-questions-panel");
    panel.parentElement!.scrollIntoView = scrollIntoViewMock;

    screen.getByText("action-bar-scroll").click();
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("passes run events to the event timeline", () => {
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: "run-123",
        eventType: "RUN_REQUESTED",
        source: "human",
        payloadJson: null,
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    useRunMock.mockReturnValue({
      data: { run: makeRun({}), artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run Requested")).toBeDefined();
  });
});
