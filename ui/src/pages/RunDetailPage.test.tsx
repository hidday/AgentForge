import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useParams: () => ({ id: "run-1" }) };
});

const useRunMock = vi.fn();
vi.mock("@/hooks/useRun.ts", () => ({ useRun: () => useRunMock() }));

const useActiveProcessesMock = vi.fn();
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: () => useActiveProcessesMock(),
}));

const useRunSkillsMock = vi.fn();
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: () => useRunSkillsMock(),
}));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <span data-testid="state-badge">{state}</span>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: () => <div data-testid="workflow-stepper" />,
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: () => <div data-testid="artifact-tabs" />,
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

let capturedQuestionsProps: Array<Record<string, unknown>> = [];
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: Record<string, unknown>) => {
    capturedQuestionsProps.push(props);
    return <div data-testid="open-questions-panel">{(props.questions as unknown[]).length}</div>;
  },
}));

let capturedActionBarProps: Record<string, unknown> | null = null;
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: Record<string, unknown>) => {
    capturedActionBarProps = props;
    return <div data-testid="action-bar" />;
  },
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "My issue",
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
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RunDetailPage />
    </MemoryRouter>,
  );
}

const defaultActiveProcesses = { processes: [], hasActive: false, output: "", activeProcessId: null };
const defaultSkills = { data: null, loading: false, error: null, refetch: vi.fn() };

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedQuestionsProps = [];
    capturedActionBarProps = null;
    useActiveProcessesMock.mockReturnValue(defaultActiveProcesses);
    useRunSkillsMock.mockReturnValue(defaultSkills);
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows the error message when the hook reports an error", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "boom",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows 'Run not found' when there's no error but also no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run header with issue title, repo, and state badge", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("My issue")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
  });

  it("falls back to linearIssueIdentifier, then a truncated id, for the issue label", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("renders the PR link only when prNumber is present", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ prNumber: 7 }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const link = screen.getByTitle("Open PR on GitHub") as HTMLAnchorElement;
    expect(link.href).toBe("https://github.com/org/repo/pull/7");
  });

  it("does not render branch-dependent links when branchName is absent", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ branchName: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle("Open Claude Code session in this run's worktree")).toBeNull();
  });

  it("renders branch-dependent links when branchName and workingDirectory are present", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ branchName: "feature/x", workingDirectory: "/tmp/work" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
    expect(screen.getByText("feature/x")).toBeDefined();
  });

  it("shows the required open questions panel for HumanClarificationNeeded state", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
            { id: "q2", question: "Optional?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts,
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    // All open questions (both required and optional) surface here.
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2");
    expect(capturedActionBarProps?.hasOptionalQuestions).toBe(true);
  });

  it("shows only optional open questions panel for AwaitingPlanApproval state", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Required", requiredForExecution: true },
            { id: "q2", question: "Optional", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts,
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1");
  });

  it("renders no open-questions panel for states without open questions", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ state: "Implementing" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(capturedActionBarProps?.hasOptionalQuestions).toBe(false);
  });

  it("passes onScrollToQuestions to ActionBar that scrolls the questions ref into view", () => {
    const scrollIntoViewMock = vi.fn();
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: { openQuestions: [{ id: "q1", question: "Q", requiredForExecution: true }] },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts,
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const el = screen.getByTestId("open-questions-panel").parentElement!;
    el.scrollIntoView = scrollIntoViewMock;

    (capturedActionBarProps?.onScrollToQuestions as () => void)();
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("renders child panels: agent output, artifacts, events, chat, distilled skill, workflow stepper", () => {
    const events: RunEventRecord[] = [];
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
  });
});
