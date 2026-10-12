import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

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
    <div data-testid="state-badge" data-state={props.state} />
  )),
}));

vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: vi.fn(
    (props: { currentState: string; events: RunEventRecord[] }) => (
      <div
        data-testid="workflow-stepper"
        data-state={props.currentState}
        data-events={props.events.length}
      />
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
    (props: { processes: unknown[]; output: string }) => (
      <div
        data-testid="agent-output-panel"
        data-processes={props.processes.length}
        data-output={props.output}
      />
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
      <div
        data-testid="action-bar"
        data-run-id={props.runId}
        data-state={props.state}
        data-has-optional={String(props.hasOptionalQuestions)}
      >
        <button onClick={props.onAction}>action-bar-action</button>
        <button onClick={props.onScrollToQuestions}>action-bar-scroll</button>
      </div>
    ),
  ),
}));

vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: vi.fn(
    (props: {
      questions: { id: string }[];
      runId: string;
      runState?: string;
      onSubmitted?: () => void;
    }) => (
      <div
        data-testid="open-questions-panel"
        data-count={props.questions.length}
        data-run-state={props.runState}
      >
        <button onClick={props.onSubmitted}>submit-questions</button>
      </div>
    ),
  ),
}));

vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: vi.fn((props: { runId: string; artifacts: Artifact[] }) => (
    <div
      data-testid="chat-panel"
      data-run-id={props.runId}
      data-artifacts={props.artifacts.length}
    />
  )),
}));

vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: vi.fn(
    (props: {
      distilledSkill: { id: string } | null;
      distillationDecision: unknown;
      loading: boolean;
      error: string | null;
    }) => (
      <div
        data-testid="distilled-skill-panel"
        data-loading={String(props.loading)}
        data-error={props.error ?? ""}
        data-skill={props.distilledSkill?.id ?? ""}
      />
    ),
  ),
}));

import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { RunDetailPage } from "./RunDetailPage.tsx";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<
  typeof vi.fn
>;

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "11111111-0000-0000-0000-000000000000",
    linearIssueId: "issue-abc12345",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function defaultSkillsState() {
  return {
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
}

function defaultActiveProcessesState() {
  return {
    processes: [],
    hasActive: false,
    output: "",
    activeProcessId: null,
  };
}

function renderPage(id = "run-1") {
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
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    mockUseRunSkills.mockReturnValue(defaultSkillsState());
    mockUseActiveProcesses.mockReturnValue(defaultActiveProcessesState());
  });

  it("renders the loading state when the run is loading", () => {
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

  it("renders the error message when the hook reports an error", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run fetch failed",
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Run fetch failed")).toBeDefined();
  });

  it("renders a 'Run not found' fallback when there is no error and no data", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("wires loading/empty data through to all child components when populated with no artifacts/events", () => {
    const run = makeRun({});
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("state-badge").getAttribute("data-state")).toBe(
      "Todo",
    );
    expect(
      screen.getByTestId("workflow-stepper").getAttribute("data-state"),
    ).toBe("Todo");
    expect(
      screen.getByTestId("workflow-stepper").getAttribute("data-events"),
    ).toBe("0");
    expect(
      screen.getByTestId("artifact-tabs").getAttribute("data-count"),
    ).toBe("0");
    expect(
      screen.getByTestId("event-timeline").getAttribute("data-count"),
    ).toBe("0");
    expect(screen.getByTestId("action-bar").getAttribute("data-run-id")).toBe(
      run.id,
    );
    expect(screen.getByTestId("action-bar").getAttribute("data-state")).toBe(
      "Todo",
    );
    expect(
      screen.getByTestId("action-bar").getAttribute("data-has-optional"),
    ).toBe("false");
    expect(screen.getByTestId("chat-panel").getAttribute("data-run-id")).toBe(
      run.id,
    );
    expect(
      screen.getByTestId("chat-panel").getAttribute("data-artifacts"),
    ).toBe("0");

    // No open questions panel for Todo state.
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();

    // Header fields.
    expect(screen.getByText(run.id.slice(0, 8))).toBeDefined();
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
  });

  it("wires active-process output and skills data into the relevant panels", () => {
    const run = makeRun({ state: "Implementing" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue({
      processes: [{ id: "p1" }],
      hasActive: true,
      output: "some output",
      activeProcessId: "p1",
    });
    mockUseRunSkills.mockReturnValue({
      data: {
        injectedSkills: [],
        distillationDecision: { shouldPersist: true } as unknown,
        distilledSkill: { id: "skill-1" },
      },
      loading: false,
      error: "skills error",
      refetch: vi.fn(),
    });

    renderPage();

    const agentOutput = screen.getByTestId("agent-output-panel");
    expect(agentOutput.getAttribute("data-processes")).toBe("1");
    expect(agentOutput.getAttribute("data-output")).toBe("some output");

    const distilled = screen.getByTestId("distilled-skill-panel");
    expect(distilled.getAttribute("data-skill")).toBe("skill-1");
    expect(distilled.getAttribute("data-error")).toBe("skills error");
    expect(distilled.getAttribute("data-loading")).toBe("false");
  });

  it("falls back to linearIssueIdentifier when there is no issue title", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-42" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("ENG-42")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when there is no title or identifier", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "issue-1234567890",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("issue-12")).toBeDefined();
  });

  it("renders optional links only when their backing fields are present", () => {
    const base = makeRun({});
    mockUseRun.mockReturnValue({
      data: { run: base, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("renders the branch, PR, Linear, Cursor and Claude links when present", () => {
    const run = makeRun({
      branchName: "feature/foo",
      prNumber: 42,
      linearIssueUrl: "https://linear.app/issue/1",
      workingDirectory: "/work/dir",
      repo: "org/repo",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("feature/foo")).toBeDefined();
    expect(screen.getByText("PR #42")).toBeDefined();
    const prLink = screen.getByTitle("Open PR on GitHub") as HTMLAnchorElement;
    expect(prLink.getAttribute("href")).toBe(
      "https://github.com/org/repo/pull/42",
    );
    expect(
      (screen.getByTitle("Open in Linear") as HTMLAnchorElement).getAttribute(
        "href",
      ),
    ).toBe("https://linear.app/issue/1");
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(
      screen.getByTitle("Open Claude Code session in this run's worktree"),
    ).toBeDefined();
    expect(
      screen.getByTitle("Open Claude Desktop (Code) in this run's worktree"),
    ).toBeDefined();
  });

  it("shows the required open-questions panel in HumanClarificationNeeded state", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Required?", requiredForExecution: true },
            { id: "q2", question: "Optional?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const panel = screen.getByTestId("open-questions-panel");
    // Both required and optional questions shown for HumanClarificationNeeded.
    expect(panel.getAttribute("data-count")).toBe("2");
    expect(panel.getAttribute("data-run-state")).toBe(
      "HumanClarificationNeeded",
    );
  });

  it("shows only the optional open-questions panel in AwaitingPlanApproval state, and reports hasOptionalQuestions", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Required?", requiredForExecution: true },
            { id: "q2", question: "Optional?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
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
    expect(
      screen.getByTestId("action-bar").getAttribute("data-has-optional"),
    ).toBe("true");
  });

  it("does not render an open-questions panel when there is no Plan artifact", () => {
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

  it("calls refetch when ActionBar triggers onAction or OpenQuestionsPanel triggers onSubmitted", async () => {
    const refetch = vi.fn();
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Required?", requiredForExecution: true },
          ],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch,
    });

    renderPage();

    await userEvent.click(screen.getByText("action-bar-action"));
    expect(refetch).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByText("submit-questions"));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("scrolls the open-questions panel into view when ActionBar requests it", async () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q2", question: "Optional?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    await userEvent.click(screen.getByText("action-bar-scroll"));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });
});
