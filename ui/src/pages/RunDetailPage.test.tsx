import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run, Artifact, RunEventRecord, ActiveProcess } from "@/api/client.ts";

// Mock react-router's useParams while keeping the rest (Link, MemoryRouter) real.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useParams: () => ({ id: "run-123" }),
  };
});

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => (
    <div data-testid="state-badge">{state}</div>
  ),
}));

vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: ({
    currentState,
    events,
  }: {
    currentState: string;
    events: RunEventRecord[];
  }) => (
    <div
      data-testid="workflow-stepper"
      data-state={currentState}
      data-events={events.length}
    />
  ),
}));

vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs" data-count={artifacts.length} />
  ),
}));

vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: ({
    processes,
    output,
  }: {
    processes: ActiveProcess[];
    output: string;
  }) => (
    <div
      data-testid="agent-output-panel"
      data-processes={processes.length}
      data-output={output}
    />
  ),
}));

vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline" data-count={events.length} />
  ),
}));

vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    state,
    onAction,
    onScrollToQuestions,
    hasOptionalQuestions,
  }: {
    state: string;
    onAction: () => void;
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  }) => (
    <div
      data-testid="action-bar"
      data-state={state}
      data-has-optional={String(hasOptionalQuestions)}
    >
      <button onClick={onAction}>action-bar-act</button>
      <button onClick={() => onScrollToQuestions?.()}>action-bar-scroll</button>
    </div>
  ),
}));

vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({
    questions,
    runState,
  }: {
    questions: unknown[];
    runState?: string;
  }) => (
    <div
      data-testid="open-questions-panel"
      data-count={questions.length}
      data-run-state={runState}
    />
  ),
}));

vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: ({ runId, artifacts }: { runId: string; artifacts: Artifact[] }) => (
    <div data-testid="chat-panel" data-run-id={runId} data-count={artifacts.length} />
  ),
}));

vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: ({
    loading,
    error,
  }: {
    loading?: boolean;
    error?: string | null;
  }) => (
    <div
      data-testid="distilled-skill-panel"
      data-loading={String(loading)}
      data-error={error ?? ""}
    />
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";
import { useRun } from "@/hooks/useRun.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-123456789",
    linearIssueId: "issue-abcdefgh",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the widget",
    linearIssueUrl: "https://linear.app/team/issue/ENG-42",
    repo: "org/repo",
    branchName: "agent/eng-42",
    prNumber: 7,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-123",
    latestArtifactVersion: 2,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePlanArtifact(openQuestions: Array<{ id: string; question: string; requiredForExecution: boolean }>): Artifact {
  return {
    id: "artifact-plan",
    runId: "run-123456789",
    type: "Plan",
    version: 1,
    payloadJson: { openQuestions },
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

const defaultActiveProcesses = {
  processes: [],
  hasActive: false,
  output: "",
  activeProcessId: null,
};

const defaultSkills = {
  data: null,
  loading: false,
  error: null,
  refetch: vi.fn(),
};

function renderPage() {
  return render(
    <MemoryRouter>
      <RunDetailPage />
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveProcesses.mockReturnValue(defaultActiveProcesses);
    mockUseRunSkills.mockReturnValue(defaultSkills);
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

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

  it("shows 'Run not found' when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the composed run detail view and wires props through to children on success", () => {
    const run = makeRun();
    const artifacts: Artifact[] = [makePlanArtifact([])];
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
    mockUseActiveProcesses.mockReturnValue({
      processes: [{ id: "p1" } as ActiveProcess],
      hasActive: true,
      output: "some agent output",
      activeProcessId: "p1",
    });

    renderPage();

    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTestId("workflow-stepper").getAttribute("data-state")).toBe(
      "Implementing",
    );
    expect(screen.getByTestId("workflow-stepper").getAttribute("data-events")).toBe("1");
    expect(screen.getByTestId("artifact-tabs").getAttribute("data-count")).toBe("1");
    expect(screen.getByTestId("agent-output-panel").getAttribute("data-processes")).toBe(
      "1",
    );
    expect(screen.getByTestId("agent-output-panel").getAttribute("data-output")).toBe(
      "some agent output",
    );
    expect(screen.getByTestId("event-timeline").getAttribute("data-count")).toBe("1");
    expect(screen.getByTestId("chat-panel").getAttribute("data-run-id")).toBe(run.id);
    expect(screen.getByTestId("chat-panel").getAttribute("data-count")).toBe("1");
    expect(screen.getByTestId("action-bar").getAttribute("data-state")).toBe(
      "Implementing",
    );

    // Header details
    expect(screen.getByText(run.id.slice(0, 8))).toBeDefined();
    expect(screen.getByText(run.linearIssueTitle!)).toBeDefined();
    expect(screen.getByText(run.repo)).toBeDefined();
    expect(screen.getByText(run.branchName!)).toBeDefined();
    expect(screen.getByRole("link", { name: /linear/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /pr #7/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /cursor/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /claude code/i })).toBeDefined();
  });

  it("does not render optional links when branch/PR/working-directory data is absent", () => {
    const run = makeRun({
      branchName: null,
      prNumber: null,
      workingDirectory: "",
      linearIssueUrl: null,
      linearIssueTitle: null,
      linearIssueIdentifier: null,
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByRole("link", { name: /linear/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^pr #/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /cursor/i })).toBeNull();
    // Falls back to the linearIssueId when title/identifier are absent
    expect(screen.getByText(run.linearIssueId.slice(0, 8))).toBeDefined();
  });

  it("shows all open questions prominently when the run needs human clarification", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makePlanArtifact([
        { id: "q1", question: "Required?", requiredForExecution: true },
        { id: "q2", question: "Optional?", requiredForExecution: false },
      ]),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.getAttribute("data-count")).toBe("2");
    expect(panel.getAttribute("data-run-state")).toBe("HumanClarificationNeeded");
    expect(screen.getByTestId("action-bar").getAttribute("data-has-optional")).toBe(
      "true",
    );
  });

  it("shows only optional open questions when awaiting plan approval", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts = [
      makePlanArtifact([
        { id: "q1", question: "Required?", requiredForExecution: true },
        { id: "q2", question: "Optional?", requiredForExecution: false },
      ]),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.getAttribute("data-count")).toBe("1");
    expect(panel.getAttribute("data-run-state")).toBe("AwaitingPlanApproval");
  });

  it("does not render the open questions panel for states with no matching branch", () => {
    const run = makeRun({ state: "Implementing" });
    const artifacts = [
      makePlanArtifact([{ id: "q1", question: "Required?", requiredForExecution: true }]),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("action-bar").getAttribute("data-has-optional")).toBe(
      "false",
    );
  });

  it("treats a run with no Plan artifact as having no open questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("passes skills loading/error state through to the DistilledSkillPanel", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: true,
      error: "Skills failed",
      refetch: vi.fn(),
    });

    renderPage();

    const panel = screen.getByTestId("distilled-skill-panel");
    expect(panel.getAttribute("data-loading")).toBe("true");
    expect(panel.getAttribute("data-error")).toBe("Skills failed");
  });

  it("calls refetch when the action bar reports a completed action", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });

    renderPage();

    await user.click(screen.getByRole("button", { name: "action-bar-act" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("scrolls the open questions panel into view when the action bar requests it", async () => {
    const user = userEvent.setup();
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makePlanArtifact([{ id: "q1", question: "Required?", requiredForExecution: true }]),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    await user.click(screen.getByRole("button", { name: "action-bar-scroll" }));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });
});
