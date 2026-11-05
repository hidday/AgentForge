import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Artifact, Run, RunEventRecord } from "@/api/client.ts";

const mockUseRun = vi.fn();
const mockUseRunSkills = vi.fn();
const mockUseActiveProcesses = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (id: string) => mockUseRun(id),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => mockUseRunSkills(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => mockUseActiveProcesses(id),
}));

vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: {
    runId: string;
    state: string;
    onAction: () => void;
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  }) => (
    <div data-testid="action-bar-mock">
      <span data-testid="action-bar-state">{props.state}</span>
      <span data-testid="action-bar-has-optional">{String(props.hasOptionalQuestions)}</span>
      <button onClick={props.onAction}>action-bar-trigger-action</button>
      <button onClick={props.onScrollToQuestions}>action-bar-scroll-to-questions</button>
    </div>
  ),
}));

vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: (props: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs-mock">{props.artifacts.length}</div>
  ),
}));

vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: (props: { processes: unknown[]; output: string }) => (
    <div data-testid="agent-output-mock">
      {props.processes.length}:{props.output}
    </div>
  ),
}));

vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: (props: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline-mock">{props.events.length}</div>
  ),
}));

vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: (props: { currentState: string; events: unknown[] }) => (
    <div data-testid="workflow-stepper-mock">{props.currentState}</div>
  ),
}));

vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: (props: {
    distilledSkill: unknown;
    distillationDecision: unknown;
    loading?: boolean;
    error?: string | null;
  }) => (
    <div data-testid="distilled-skill-mock">
      {String(props.loading)}:{props.error ?? "no-error"}:
      {props.distilledSkill ? "has-skill" : "no-skill"}
    </div>
  ),
}));

vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: (props: { runId: string; artifacts: Artifact[] }) => (
    <div data-testid="chat-panel-mock">{props.runId}</div>
  ),
}));

vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: {
    questions: Array<{ id: string; question: string; requiredForExecution: boolean }>;
    runId: string;
    readOnly: boolean;
    runState?: string;
    onSubmitted?: () => void;
  }) => (
    <div data-testid="open-questions-mock">
      <span data-testid="open-questions-count">{props.questions.length}</span>
      <span data-testid="open-questions-state">{props.runState}</span>
      <button onClick={props.onSubmitted}>open-questions-submit</button>
    </div>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1234567890",
    linearIssueId: "issue-1234567890",
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
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "a1",
    runId: "run-1234567890",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage(initialPath = "/runs/run-1234567890") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveProcesses.mockReturnValue({ processes: [], output: "" });
    mockUseRunSkills.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows an error message when the hook reports an error", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "network down",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("network down")).toBeDefined();
  });

  it("shows a fallback 'Run not found' message when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Run not found/i)).toBeDefined();
  });

  it("renders the run header with id, issue, repo, and state badge", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = renderPage();

    expect(screen.getByText("run-1234")).toBeDefined(); // id.slice(0, 8)
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    // The StateBadge in the header carries the idle-category classes for Todo.
    expect(container.querySelector(".bg-state-idle-bg")).not.toBeNull();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
  });

  it("falls back to linearIssueIdentifier, then to a slice of linearIssueId, in the header", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-42" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { rerender } = renderPage();
    expect(screen.getByText("ENG-42")).toBeDefined();

    const run2 = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "abcdefghijklmnop",
    });
    mockUseRun.mockReturnValue({
      data: { run: run2, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    rerender(
      <MemoryRouter initialEntries={["/runs/run-1234567890"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders the Linear issue link when linearIssueUrl is set", () => {
    const run = makeRun({ linearIssueUrl: "https://linear.app/acme/issue/ENG-1" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/acme/issue/ENG-1");
  });

  it("renders the PR link when prNumber is set", () => {
    const run = makeRun({ prNumber: 7, repo: "acme/widgets" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const link = screen.getByTitle("Open PR on GitHub");
    expect(link.getAttribute("href")).toBe("https://github.com/acme/widgets/pull/7");
  });

  it("renders branch/editor links only when both branchName and workingDirectory are set", () => {
    const run = makeRun({ branchName: "agent/eng-1", workingDirectory: "/tmp/worktree" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("agent/eng-1")).toBeDefined();
    expect(screen.getByTitle("Open in Cursor").getAttribute("href")).toBe(
      "cursor://file/tmp/worktree",
    );
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });

  it("does not render branch/editor links when branchName is absent", () => {
    const run = makeRun({ branchName: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("passes run state and events down to WorkflowStepper and EventTimeline", () => {
    const run = makeRun({ state: "Implementing" });
    const events: RunEventRecord[] = [
      { id: "e1", runId: run.id, eventType: "x", source: "system", payloadJson: null, createdAt: "2024-01-01T00:00:00Z" },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("workflow-stepper-mock").textContent).toBe("Implementing");
    expect(screen.getByTestId("event-timeline-mock").textContent).toBe("1");
  });

  it("passes artifacts to ArtifactTabs and ChatPanel", () => {
    const run = makeRun();
    const artifacts = [makeArtifact({ id: "a1" }), makeArtifact({ id: "a2", type: "ExecutionReport" })];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("artifact-tabs-mock").textContent).toBe("2");
    expect(screen.getByTestId("chat-panel-mock").textContent).toBe(run.id);
  });

  it("passes the active processes and output from the hook to AgentOutputPanel", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue({
      processes: [{ id: "p1" }],
      output: "hello world",
    });
    renderPage();
    expect(screen.getByTestId("agent-output-mock").textContent).toBe("1:hello world");
  });

  it("passes skills data/loading/error from useRunSkills to DistilledSkillPanel", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRunSkills.mockReturnValue({
      data: {
        distilledSkill: { id: "s1" },
        distillationDecision: null,
        injectedSkills: [],
      },
      loading: true,
      error: "skill fetch failed",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("distilled-skill-mock").textContent).toBe(
      "true:skill fetch failed:has-skill",
    );
  });

  it("shows the prominent open questions panel when HumanClarificationNeeded has open questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makeArtifact({
        type: "Plan",
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "A?", requiredForExecution: true },
            { id: "q2", question: "B?", requiredForExecution: false },
          ],
        },
      }),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const panel = screen.getByTestId("open-questions-mock");
    expect(panel).toBeDefined();
    expect(screen.getByTestId("open-questions-count").textContent).toBe("2");
    expect(screen.getByTestId("open-questions-state").textContent).toBe(
      "HumanClarificationNeeded",
    );
  });

  it("does not show the open questions panel for HumanClarificationNeeded when there are no questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions-mock")).toBeNull();
  });

  it("shows only optional (non-required) open questions for AwaitingPlanApproval", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts = [
      makeArtifact({
        type: "Plan",
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Required?", requiredForExecution: true },
            { id: "q2", question: "Optional?", requiredForExecution: false },
          ],
        },
      }),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("open-questions-count").textContent).toBe("1");
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("true");
  });

  it("does not render the optional questions panel outside AwaitingPlanApproval, even though hasOptionalQuestions still reflects the plan", () => {
    const run = makeRun({ state: "Implementing" });
    const artifacts = [
      makeArtifact({
        type: "Plan",
        payloadJson: {
          openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
        },
      }),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    // The panel itself is only rendered inline for AwaitingPlanApproval /
    // HumanClarificationNeeded, but hasOptionalQuestions is derived from the
    // plan independent of the current state, so ActionBar still sees it.
    expect(screen.queryByTestId("open-questions-mock")).toBeNull();
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("true");
  });

  it("handles a Plan artifact with no openQuestions field gracefully", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts = [makeArtifact({ type: "Plan", payloadJson: { summary: "ok" } })];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions-mock")).toBeNull();
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("false");
  });

  it("forwards run id and state to ActionBar and triggers refetch via onAction", async () => {
    const refetch = vi.fn();
    const run = makeRun({ state: "Implementing" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    expect(screen.getByTestId("action-bar-state").textContent).toBe("Implementing");
    await userEvent.click(screen.getByText("action-bar-trigger-action"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("scrolls the open questions panel into view when ActionBar requests it", async () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makeArtifact({
        type: "Plan",
        payloadJson: {
          openQuestions: [{ id: "q1", question: "A?", requiredForExecution: true }],
        },
      }),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    renderPage();
    await userEvent.click(screen.getByText("action-bar-scroll-to-questions"));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("calls refetch when the open questions panel reports a submission", async () => {
    const refetch = vi.fn();
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makeArtifact({
        type: "Plan",
        payloadJson: {
          openQuestions: [{ id: "q1", question: "A?", requiredForExecution: true }],
        },
      }),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    await userEvent.click(screen.getByText("open-questions-submit"));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
