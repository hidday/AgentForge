import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: (id: string) => useRunMock(id) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: (id: string) => useRunSkillsMock(id) }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
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
let capturedActionBarProps: { onScrollToQuestions?: () => void } | null = null;
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: { onScrollToQuestions?: () => void }) => {
    capturedActionBarProps = props;
    return <div data-testid="action-bar" />;
  },
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
    id: "run-id-12345678",
    linearIssueId: "issue-12345678",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
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
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderWithData(
  run: Run,
  artifacts: Artifact[] = [],
  events: RunEventRecord[] = [],
) {
  useRunMock.mockReturnValue({
    data: { run, artifacts, events },
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
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

  return render(
    <MemoryRouter initialEntries={[`/runs/${run.id}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedActionBarProps = null;
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    useRunSkillsMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    useActiveProcessesMock.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });

    render(
      <MemoryRouter initialEntries={["/runs/r1"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows an error message when the run fails to load", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "boom",
      refetch: vi.fn(),
    });
    useRunSkillsMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    useActiveProcessesMock.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });

    render(
      <MemoryRouter initialEntries={["/runs/r1"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows 'Run not found' when there is no error but also no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    useRunSkillsMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    useActiveProcessesMock.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });

    render(
      <MemoryRouter initialEntries={["/runs/r1"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the issue title, repo, truncated id, and state badge for a loaded run", () => {
    renderWithData(makeRun());
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("run-id-1")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("falls back to the issue identifier, then the truncated issue id, when no title is set", () => {
    renderWithData(makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-9" }));
    expect(screen.getByText("ENG-9")).toBeDefined();
  });

  it("falls back to a truncated issue id when neither title nor identifier is set", () => {
    renderWithData(
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefghij",
      }),
    );
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("does not render the Linear/branch/PR links when those fields are absent", () => {
    renderWithData(makeRun({ linearIssueUrl: null, branchName: null, prNumber: null }));
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("renders the Linear link, branch name, and PR link when present", () => {
    renderWithData(
      makeRun({
        linearIssueUrl: "https://linear.app/x",
        branchName: "feature/x",
        prNumber: 7,
        workingDirectory: "/tmp/work",
      }),
    );
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
    expect(screen.getByText("feature/x")).toBeDefined();
    expect(screen.getByTitle("Open PR on GitHub")).toBeDefined();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
  });

  it("shows the required-questions panel when the run is HumanClarificationNeeded with open questions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-id-12345678",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Which runtime?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    renderWithData(makeRun({ state: "HumanClarificationNeeded" }), [planArtifact]);

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.textContent).toBe("2");
  });

  it("shows only optional questions in the secondary panel when AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-id-12345678",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required", requiredForExecution: true },
          { id: "q2", question: "Optional 1", requiredForExecution: false },
          { id: "q3", question: "Optional 2", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    renderWithData(makeRun({ state: "AwaitingPlanApproval" }), [planArtifact]);

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.textContent).toBe("2");
  });

  it("renders no questions panel when there is no Plan artifact", () => {
    renderWithData(makeRun({ state: "HumanClarificationNeeded" }), []);
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("scrolls the questions ref into view when the action bar triggers onScrollToQuestions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-id-12345678",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Which runtime?", requiredForExecution: true }],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    renderWithData(makeRun({ state: "HumanClarificationNeeded" }), [planArtifact]);

    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    expect(capturedActionBarProps?.onScrollToQuestions).toBeDefined();
    capturedActionBarProps!.onScrollToQuestions!();

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("renders the core composed panels (workflow, artifacts, output, events, chat, action bar)", () => {
    renderWithData(makeRun());
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
  });
});
