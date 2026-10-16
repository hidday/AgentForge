import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord, ActiveProcess } from "@/api/client.ts";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: vi.fn(),
}));

vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: vi.fn(),
}));

vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: vi.fn(),
}));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: vi.fn((props: { state: string }) => (
    <div data-testid="state-badge">{props.state}</div>
  )),
}));

vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: vi.fn(
    (props: { currentState: string; events: RunEventRecord[] }) => (
      <div data-testid="workflow-stepper" data-state={props.currentState} />
    ),
  ),
}));

vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: vi.fn((props: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs" data-count={props.artifacts.length} />
  )),
}));

vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: vi.fn(
    (props: { processes: ActiveProcess[]; output: string }) => (
      <div data-testid="agent-output-panel" data-output={props.output}>
        {props.processes.length} processes
      </div>
    ),
  ),
}));

vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: vi.fn((props: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline" data-count={props.events.length} />
  )),
}));

vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: vi.fn(
    (props: {
      runId: string;
      state: string;
      onAction: () => void;
      onScrollToQuestions?: () => void;
      hasOptionalQuestions?: boolean;
    }) => (
      <div data-testid="action-bar">
        <button onClick={() => props.onAction()}>trigger-action</button>
        <button onClick={() => props.onScrollToQuestions?.()}>
          trigger-scroll
        </button>
        <span data-testid="has-optional">{String(props.hasOptionalQuestions)}</span>
      </div>
    ),
  ),
}));

vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: vi.fn(
    (props: {
      questions: OpenQuestion[];
      runId: string;
      readOnly?: boolean;
      runState?: string;
      onSubmitted?: () => void;
    }) => (
      <div data-testid="open-questions-panel" data-count={props.questions.length}>
        <button onClick={() => props.onSubmitted?.()}>trigger-submitted</button>
      </div>
    ),
  ),
}));

vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: vi.fn((props: { runId: string; artifacts: Artifact[] }) => (
    <div data-testid="chat-panel" data-run-id={props.runId} />
  )),
}));

vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: vi.fn(
    (props: {
      distilledSkill: unknown;
      distillationDecision: unknown;
      loading?: boolean;
      error?: string | null;
    }) => (
      <div
        data-testid="distilled-skill-panel"
        data-loading={String(props.loading)}
        data-error={props.error ?? ""}
      />
    ),
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";
import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { ActionBar } from "@/components/ActionBar.tsx";
import { OpenQuestionsPanel } from "@/components/OpenQuestionsPanel.tsx";
import { ArtifactTabs } from "@/components/ArtifactTabs.tsx";
import { AgentOutputPanel } from "@/components/AgentOutputPanel.tsx";
import { DistilledSkillPanel } from "@/components/DistilledSkillPanel.tsx";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<
  typeof vi.fn
>;
const mockActionBar = ActionBar as unknown as ReturnType<typeof vi.fn>;
const mockOpenQuestionsPanel = OpenQuestionsPanel as unknown as ReturnType<
  typeof vi.fn
>;
const mockArtifactTabs = ArtifactTabs as unknown as ReturnType<typeof vi.fn>;
const mockAgentOutputPanel = AgentOutputPanel as unknown as ReturnType<typeof vi.fn>;
const mockDistilledSkillPanel = DistilledSkillPanel as unknown as ReturnType<
  typeof vi.fn
>;

const RUN_ID = "run-abc-123";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/team/issue/ENG-42",
    repo: "acme/widgets",
    branchName: "feature/fix-thing",
    prNumber: 7,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work/widgets",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: RUN_ID,
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "event-1",
    runId: RUN_ID,
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: {},
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultUseRunResult = {
  data: null as { run: Run; artifacts: Artifact[]; events: RunEventRecord[] } | null,
  loading: false,
  error: null as string | null,
  refetch: vi.fn(),
};

const defaultSkillsResult = {
  data: null,
  loading: false,
  error: null as string | null,
};

const defaultActiveProcessesResult = {
  processes: [] as ActiveProcess[],
  hasActive: false,
  output: "",
  activeProcessId: null,
};

function renderPage(path = `/runs/${RUN_ID}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function lastActionBarProps() {
  const calls = mockActionBar.mock.calls;
  return calls[calls.length - 1]![0] as {
    runId: string;
    state: string;
    onAction: () => void;
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  };
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRun.mockReturnValue({ ...defaultUseRunResult, refetch: vi.fn() });
    mockUseRunSkills.mockReturnValue({ ...defaultSkillsResult });
    mockUseActiveProcesses.mockReturnValue({ ...defaultActiveProcessesResult });
  });

  it("passes the runId from the route params through to the data hooks", () => {
    renderPage();

    expect(mockUseRun).toHaveBeenCalledWith(RUN_ID);
    expect(mockUseRunSkills).toHaveBeenCalledWith(RUN_ID);
    expect(mockUseActiveProcesses).toHaveBeenCalledWith(RUN_ID);
  });

  it("shows the loading indicator while useRun is loading", () => {
    mockUseRun.mockReturnValue({ ...defaultUseRunResult, loading: true });
    renderPage();

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("shows the hook's error message when useRun reports an error", () => {
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      loading: false,
      error: "Boom",
      data: null,
    });
    renderPage();

    expect(screen.getByText("Boom")).toBeDefined();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("shows a 'Run not found' fallback when there is no error but data is null", () => {
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      loading: false,
      error: null,
      data: null,
    });
    renderPage();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details, StateBadge, and composed child components when populated", () => {
    const run = makeRun();
    const artifacts = [makeArtifact()];
    const events = [makeEvent()];
    const processes: ActiveProcess[] = [
      {
        id: "p1",
        pid: 123,
        command: "run",
        runId: RUN_ID,
        stage: "Implementing",
        runtime: "claude",
        startedAt: "2024-01-01T00:00:00Z",
        elapsedMs: 1000,
      },
    ];

    mockUseRun.mockReturnValue({ ...defaultUseRunResult, data: { run, artifacts, events } });
    mockUseActiveProcesses.mockReturnValue({
      ...defaultActiveProcessesResult,
      processes,
      output: "some output",
    });
    mockUseRunSkills.mockReturnValue({
      data: { distilledSkill: { markdown: "x" }, distillationDecision: { decided: true } },
      loading: true,
      error: "skill error",
    });

    renderPage();

    // Header info
    expect(screen.getByText(run.id.slice(0, 8))).toBeDefined();
    expect(screen.getByText(run.linearIssueTitle!)).toBeDefined();
    expect(screen.getByText(run.repo)).toBeDefined();
    expect(screen.getByText(run.branchName!)).toBeDefined();
    expect(screen.getByText(`PR #${run.prNumber}`)).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe(run.state);

    // Composed children receive the right data
    expect(screen.getByTestId("workflow-stepper").getAttribute("data-state")).toBe(
      run.state,
    );
    expect(mockArtifactTabs).toHaveBeenCalledWith(
      expect.objectContaining({ artifacts }),
      undefined,
    );
    expect(mockAgentOutputPanel).toHaveBeenCalledWith(
      expect.objectContaining({ processes, output: "some output" }),
      undefined,
    );
    expect(screen.getByTestId("event-timeline").getAttribute("data-count")).toBe(
      String(events.length),
    );
    expect(mockDistilledSkillPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        distilledSkill: { markdown: "x" },
        distillationDecision: { decided: true },
        loading: true,
        error: "skill error",
      }),
      undefined,
    );
    expect(screen.getByTestId("chat-panel").getAttribute("data-run-id")).toBe(run.id);

    // ActionBar wiring
    const actionBarProps = lastActionBarProps();
    expect(actionBarProps.runId).toBe(run.id);
    expect(actionBarProps.state).toBe(run.state);
    expect(actionBarProps.hasOptionalQuestions).toBe(false);
  });

  it("falls back from linearIssueTitle to linearIssueIdentifier when title is missing", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" });
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      data: { run, artifacts: [], events: [] },
    });
    renderPage();
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when title and identifier are both missing", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "abcdefghijklmnop",
    });
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      data: { run, artifacts: [], events: [] },
    });
    renderPage();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("does not render Cursor/Claude links when workingDirectory or branchName is missing", () => {
    const run = makeRun({ branchName: null, workingDirectory: "" });
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      data: { run, artifacts: [], events: [] },
    });
    renderPage();

    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle("Open Claude Code session in this run's worktree")).toBeNull();
    expect(
      screen.queryByTitle("Open Claude Desktop (Code) in this run's worktree"),
    ).toBeNull();
  });

  it("renders Cursor/Claude links when branchName and workingDirectory are both present", () => {
    const run = makeRun({ branchName: "feature/x", workingDirectory: "/work/x" });
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      data: { run, artifacts: [], events: [] },
    });
    renderPage();

    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(
      screen.getByTitle("Open Claude Code session in this run's worktree"),
    ).toBeDefined();
    expect(
      screen.getByTitle("Open Claude Desktop (Code) in this run's worktree"),
    ).toBeDefined();
  });

  it("shows OpenQuestionsPanel with all open questions when state is HumanClarificationNeeded", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Q1?", requiredForExecution: true },
      { id: "q2", question: "Q2?", requiredForExecution: false },
    ];
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { openQuestions: questions } }),
    ];
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      data: { run, artifacts, events: [] },
    });

    renderPage();

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.getAttribute("data-count")).toBe("2");
    expect(mockOpenQuestionsPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        questions,
        runId: run.id,
        readOnly: false,
        runState: run.state,
      }),
      undefined,
    );
    // Only required-for-optional filtering applies to AwaitingPlanApproval, not here
    expect(lastActionBarProps().hasOptionalQuestions).toBe(true);
  });

  it("shows OpenQuestionsPanel with only optional questions when state is AwaitingPlanApproval", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required?", requiredForExecution: true },
      { id: "q2", question: "Optional?", requiredForExecution: false },
    ];
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { openQuestions: questions } }),
    ];
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      data: { run, artifacts, events: [] },
    });

    renderPage();

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.getAttribute("data-count")).toBe("1");
    expect(mockOpenQuestionsPanel).toHaveBeenCalledWith(
      expect.objectContaining({ questions: [questions[1]], runState: run.state }),
      undefined,
    );
    expect(lastActionBarProps().hasOptionalQuestions).toBe(true);
  });

  it("does not render OpenQuestionsPanel for other states, even with open questions present", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required?", requiredForExecution: true },
    ];
    const run = makeRun({ state: "Implementing" });
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { openQuestions: questions } }),
    ];
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      data: { run, artifacts, events: [] },
    });

    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("calls refetch when ActionBar's onAction fires", () => {
    const refetch = vi.fn();
    const run = makeRun();
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      data: { run, artifacts: [], events: [] },
      refetch,
    });
    renderPage();

    screen.getByRole("button", { name: "trigger-action" }).click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("scrolls the questions panel into view when ActionBar's onScrollToQuestions fires", () => {
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makeArtifact({
        type: "Plan",
        payloadJson: {
          openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: true }],
        },
      }),
    ];
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      data: { run, artifacts, events: [] },
    });
    renderPage();

    screen.getByRole("button", { name: "trigger-scroll" }).click();

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("calls refetch when OpenQuestionsPanel's onSubmitted fires", () => {
    const refetch = vi.fn();
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makeArtifact({
        type: "Plan",
        payloadJson: {
          openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: true }],
        },
      }),
    ];
    mockUseRun.mockReturnValue({
      ...defaultUseRunResult,
      data: { run, artifacts, events: [] },
      refetch,
    });
    renderPage();

    screen.getByRole("button", { name: "trigger-submitted" }).click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
