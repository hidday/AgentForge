import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const {
  useRunMock,
  useRunSkillsMock,
  useActiveProcessesMock,
  actionBarSpy,
  openQuestionsSpy,
  workflowStepperSpy,
} = vi.hoisted(() => ({
  useRunMock: vi.fn(),
  useRunSkillsMock: vi.fn(),
  useActiveProcessesMock: vi.fn(),
  actionBarSpy: vi.fn(),
  openQuestionsSpy: vi.fn(),
  workflowStepperSpy: vi.fn(),
}));

vi.mock("@/hooks/useRun.ts", () => ({ useRun: (id: string) => useRunMock(id) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => useRunSkillsMock(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
}));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <span data-testid="state-badge">{state}</span>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: (props: unknown) => {
    workflowStepperSpy(props);
    return <div data-testid="workflow-stepper" />;
  },
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{artifacts.length} artifacts</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: ({ output }: { output: string }) => (
    <div data-testid="agent-output">{output}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length} events</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: {
    runId: string;
    state: string;
    onScrollToQuestions: () => void;
    hasOptionalQuestions: boolean;
  }) => {
    actionBarSpy(props);
    return (
      <div data-testid="action-bar">
        <button onClick={props.onScrollToQuestions}>Scroll to questions</button>
      </div>
    );
  },
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: unknown) => {
    openQuestionsSpy(props);
    return <div data-testid="open-questions-panel" />;
  },
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: ({ runId }: { runId: string }) => (
    <div data-testid="chat-panel">{runId}</div>
  ),
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/runs/${id}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
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

const defaultActiveProcesses = {
  processes: [],
  hasActive: false,
  output: "",
  activeProcessId: null,
};

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRunSkillsMock.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    useActiveProcessesMock.mockReturnValue(defaultActiveProcesses);
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderAt("run-1");

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("shows the error message when the fetch failed", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "boom",
      refetch: vi.fn(),
    });
    renderAt("run-1");

    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows a 'Run not found' fallback when there's no error and no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderAt("run-1");

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("calls the hooks with the id taken from the route params", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({}), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("run-42");

    expect(useRunMock).toHaveBeenCalledWith("run-42");
    expect(useRunSkillsMock).toHaveBeenCalledWith("run-42");
    expect(useActiveProcessesMock).toHaveBeenCalledWith("run-42");
  });

  it("renders run header details, StateBadge and artifact/event counts when loaded", () => {
    const run = makeRun({ id: "run-1", repo: "org/repo", linearIssueTitle: "Fix the bug" });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-1",
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
        runId: "run-1",
        eventType: "run:created",
        source: "system",
        payloadJson: {},
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    useRunMock.mockReturnValue({ data: { run, artifacts, events }, loading: false, error: null, refetch: vi.fn() });

    renderAt("run-1");

    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1 artifacts");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1 events");
    expect(workflowStepperSpy).toHaveBeenCalledWith(
      expect.objectContaining({ currentState: "Implementing", events }),
    );
    expect(actionBarSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", state: "Implementing" }),
    );
  });

  it("renders the PR link only when prNumber is set", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ prNumber: 7, repo: "org/repo" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("run-1");

    const prLink = screen.getByRole("link", { name: /PR #7/i });
    expect(prLink.getAttribute("href")).toBe("https://github.com/org/repo/pull/7");
  });

  it("does not render the PR link when prNumber is null", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ prNumber: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("run-1");

    expect(screen.queryByRole("link", { name: /PR #/i })).toBeNull();
  });

  it("renders branch-dependent links only when both branchName and workingDirectory are set", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ branchName: "feature/x", workingDirectory: "/work/dir" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("run-1");

    expect(screen.getByText("feature/x")).toBeDefined();
    expect(screen.getByRole("link", { name: /cursor/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /claude code/i })).toBeDefined();
  });

  it("shows the OpenQuestionsPanel for HumanClarificationNeeded with all open questions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
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

    renderAt("run-1");

    expect(screen.getByTestId("open-questions-panel")).toBeDefined();
    expect(openQuestionsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: planArtifact.payloadJson.openQuestions,
        readOnly: false,
        runState: "HumanClarificationNeeded",
      }),
    );
    expect(actionBarSpy).toHaveBeenCalledWith(
      expect.objectContaining({ hasOptionalQuestions: true }),
    );
  });

  it("shows only optional questions for AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
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

    renderAt("run-1");

    expect(openQuestionsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [planArtifact.payloadJson.openQuestions[1]],
        runState: "AwaitingPlanApproval",
      }),
    );
  });

  it("does not render OpenQuestionsPanel when there are no open questions", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("run-1");

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(actionBarSpy).toHaveBeenCalledWith(
      expect.objectContaining({ hasOptionalQuestions: false }),
    );
  });

  it("scrolls the questions panel into view when the action bar requests it", async () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
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

    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;

    renderAt("run-1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /scroll to questions/i }));

    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("passes active process output through to the AgentOutputPanel", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({}), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    useActiveProcessesMock.mockReturnValue({
      processes: [{ id: "p1" }],
      hasActive: true,
      output: "build output here",
      activeProcessId: "p1",
    });

    renderAt("run-1");

    expect(screen.getByTestId("agent-output").textContent).toBe("build output here");
  });
});
