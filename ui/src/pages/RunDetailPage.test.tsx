import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RunDetailPage } from "./RunDetailPage.tsx";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: (props: { state: string }) => (
    <span data-testid="state-badge">{props.state}</span>
  ),
}));

vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: (props: { currentState: string; events: RunEventRecord[] }) => (
    <div data-testid="workflow-stepper" data-state={props.currentState} />
  ),
}));

vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: (props: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs" data-count={props.artifacts.length} />
  ),
}));

vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));

vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: (props: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline" data-count={props.events.length} />
  ),
}));

vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: {
    runId: string;
    state: string;
    onAction: () => void;
    onScrollToQuestions: () => void;
    hasOptionalQuestions: boolean;
  }) => (
    <div
      data-testid="action-bar"
      data-run-id={props.runId}
      data-state={props.state}
      data-has-optional={String(props.hasOptionalQuestions)}
    >
      <button onClick={props.onAction}>fire-action</button>
      <button onClick={props.onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));

vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: { questions: OpenQuestion[]; runState?: string }) => (
    <div
      data-testid="open-questions-panel"
      data-count={props.questions.length}
      data-run-state={props.runState}
    />
  ),
}));

vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: (props: { runId: string; artifacts: Artifact[] }) => (
    <div data-testid="chat-panel" data-run-id={props.runId} />
  ),
}));

vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: (props: { loading?: boolean; error?: string | null }) => (
    <div
      data-testid="distilled-skill-panel"
      data-loading={String(props.loading)}
      data-error={props.error ?? ""}
    />
  ),
}));

import { useRun } from "@/hooks/useRun.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-abc12345",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the widget",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-abc",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePlanArtifact(questions: OpenQuestion[]): Artifact {
  return {
    id: "artifact-plan",
    runId: "run-abc12345",
    type: "Plan",
    version: 1,
    payloadJson: { openQuestions: questions },
    rawText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const EVENTS: RunEventRecord[] = [
  {
    id: "evt-1",
    runId: "run-abc12345",
    eventType: "run:created",
    source: "system",
    payloadJson: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

function renderAtRoute() {
  return render(
    <MemoryRouter initialEntries={["/runs/abc12345"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    mockUseRun.mockReset();
    mockUseActiveProcesses.mockReset();
    mockUseRunSkills.mockReset();
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRoute();

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("shows the error message when the fetch fails", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run fetch failed",
      refetch: vi.fn(),
    });

    renderAtRoute();

    expect(screen.getByText("Run fetch failed")).toBeDefined();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("falls back to 'Run not found' when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRoute();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details and hides optional links when absent", () => {
    const run = makeRun({
      branchName: null,
      prNumber: null,
      linearIssueUrl: null,
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: EVENTS },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRoute();

    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByText("Fix the widget")).toBeDefined();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle("Open Claude Code session in this run's worktree")).toBeNull();
    expect(screen.queryByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeNull();

    const table = screen.getByTestId("artifact-tabs");
    expect(table.getAttribute("data-count")).toBe("0");
    expect(screen.getByTestId("event-timeline").getAttribute("data-count")).toBe("1");
    expect(screen.getByTestId("action-bar").getAttribute("data-run-id")).toBe(run.id);
    expect(screen.getByTestId("chat-panel").getAttribute("data-run-id")).toBe(run.id);
  });

  it("renders branch/PR/working-directory links when present", () => {
    const run = makeRun({
      branchName: "feature/xyz",
      prNumber: 42,
      workingDirectory: "/work/dir",
      linearIssueUrl: "https://linear.app/issue/1",
      repo: "acme/widgets",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRoute();

    const linearLink = screen.getByTitle("Open in Linear") as HTMLAnchorElement;
    expect(linearLink.href).toBe("https://linear.app/issue/1");

    const prLink = screen.getByTitle("Open PR on GitHub") as HTMLAnchorElement;
    expect(prLink.href).toBe("https://github.com/acme/widgets/pull/42");

    expect(screen.getByText("feature/xyz")).toBeDefined();

    const cursorLink = screen.getByTitle("Open in Cursor") as HTMLAnchorElement;
    expect(cursorLink.getAttribute("href")).toBe("cursor://file/work/dir");
  });

  it("falls back to the Linear issue identifier when there is no title", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: "ENG-99",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRoute();

    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back to a truncated Linear issue id when there is no title or identifier", () => {
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

    renderAtRoute();

    expect(screen.getByText("issue-12")).toBeDefined();
  });

  it("shows all open questions when HumanClarificationNeeded and questions exist", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required?", requiredForExecution: true },
      { id: "q2", question: "Optional?", requiredForExecution: false },
    ];
    const run = makeRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [makePlanArtifact(questions)], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRoute();

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.getAttribute("data-count")).toBe("2");
    expect(panel.getAttribute("data-run-state")).toBe("HumanClarificationNeeded");
    expect(screen.getByTestId("action-bar").getAttribute("data-has-optional")).toBe(
      "true",
    );
  });

  it("does not render the questions panel when HumanClarificationNeeded but there are no questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRoute();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("shows only optional questions when AwaitingPlanApproval", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required?", requiredForExecution: true },
      { id: "q2", question: "Optional?", requiredForExecution: false },
    ];
    const run = makeRun({ state: "AwaitingPlanApproval" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [makePlanArtifact(questions)], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRoute();

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.getAttribute("data-count")).toBe("1");
    expect(panel.getAttribute("data-run-state")).toBe("AwaitingPlanApproval");
  });

  it("scrolls the questions panel into view when the action bar requests it", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required?", requiredForExecution: true },
    ];
    const run = makeRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [makePlanArtifact(questions)], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRoute();

    await user.click(screen.getByRole("button", { name: "scroll-to-questions" }));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("calls refetch when the action bar reports an action", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });

    renderAtRoute();

    await user.click(screen.getByRole("button", { name: "fire-action" }));

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("passes loading and error state through to the distilled skill panel", () => {
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
      error: "skills unavailable",
      refetch: vi.fn(),
    });

    renderAtRoute();

    const panel = screen.getByTestId("distilled-skill-panel");
    expect(panel.getAttribute("data-loading")).toBe("true");
    expect(panel.getAttribute("data-error")).toBe("skills unavailable");
  });
});
