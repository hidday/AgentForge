import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: (props: { state: string }) => <div data-testid="state-badge">{props.state}</div>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: (props: { currentState: string }) => (
    <div data-testid="workflow-stepper">{props.currentState}</div>
  ),
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: (props: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{props.artifacts.length}</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: (props: { output: string }) => (
    <div data-testid="agent-output-panel">{props.output}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: (props: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{props.events.length}</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: {
    onAction: () => void;
    onScrollToQuestions: () => void;
    hasOptionalQuestions: boolean;
  }) => (
    <div data-testid="action-bar">
      <button onClick={props.onAction}>action-bar-action</button>
      <button onClick={props.onScrollToQuestions}>scroll-to-questions</button>
      <span data-testid="has-optional">{String(props.hasOptionalQuestions)}</span>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: { questions: OpenQuestion[]; onSubmitted?: () => void }) => (
    <div data-testid="open-questions-panel">
      <span data-testid="question-count">{props.questions.length}</span>
      <button onClick={() => props.onSubmitted?.()}>submit-questions</button>
    </div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: (props: { loading: boolean; error: string | null }) => (
    <div data-testid="distilled-skill-panel">
      {props.loading ? "loading" : props.error ?? "ready"}
    </div>
  ),
}));

import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { RunDetailPage } from "./RunDetailPage.tsx";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1234567890",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
    branchName: "fix/bug",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
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

const defaultSkills = { data: null, loading: false, error: null };
const defaultProcesses = { processes: [], hasActive: false, output: "", activeProcessId: null };

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRunSkills.mockReturnValue(defaultSkills);
    mockUseActiveProcesses.mockReturnValue(defaultProcesses);
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText(/Loading run/i)).toBeDefined();
    expect(screen.queryByTestId("workflow-stepper")).toBeNull();
  });

  it("shows the error message when the run fails to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run not found",
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("shows a fallback message when there's no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details, badges, and links once loaded", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("fix/bug")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByRole("link", { name: /Linear/i })).toHaveProperty(
      "href",
      "https://linear.app/issue/ENG-1",
    );
    expect(screen.getByRole("link", { name: /PR #42/i })).toHaveProperty(
      "href",
      "https://github.com/org/repo/pull/42",
    );
  });

  it("falls back to the Linear issue identifier when there's no title", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when there's no title or identifier", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "abcdefghijklmnop",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("passes artifacts and events through to ArtifactTabs and EventTimeline", () => {
    const run = makeRun();
    const artifacts: Artifact[] = [
      { id: "a1", runId: run.id, type: "Plan", version: 1, payloadJson: {}, rawText: "", createdAt: "" },
    ];
    const events: RunEventRecord[] = [
      { id: "e1", runId: run.id, eventType: "run:created", source: "system", payloadJson: {}, createdAt: "" },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
  });

  it("shows the OpenQuestionsPanel with all open questions when state is HumanClarificationNeeded", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Which env?", requiredForExecution: true },
      { id: "q2", question: "Perf target?", requiredForExecution: false },
    ];
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: { openQuestions: questions },
        rawText: "",
        createdAt: "",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("open-questions-panel")).toBeDefined();
    expect(screen.getByTestId("question-count").textContent).toBe("2");
  });

  it("shows only optional questions in the OpenQuestionsPanel when state is AwaitingPlanApproval", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Which env?", requiredForExecution: true },
      { id: "q2", question: "Perf target?", requiredForExecution: false },
    ];
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: { openQuestions: questions },
        rawText: "",
        createdAt: "",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("question-count").textContent).toBe("1");
    expect(screen.getByTestId("has-optional").textContent).toBe("true");
  });

  it("does not render an OpenQuestionsPanel when there are no open questions for the current state", () => {
    const run = makeRun({ state: "Implementing" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("has-optional").textContent).toBe("false");
  });

  it("calls refetch when the ActionBar reports an action", () => {
    const run = makeRun();
    const refetch = vi.fn();
    mockUseRun.mockReturnValue({ data: { run, artifacts: [], events: [] }, loading: false, error: null, refetch });
    renderPage();

    fireEvent.click(screen.getByText("action-bar-action"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("calls refetch when the OpenQuestionsPanel reports a submission", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const refetch = vi.fn();
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: { openQuestions: [{ id: "q1", question: "Q", requiredForExecution: true }] },
        rawText: "",
        createdAt: "",
      },
    ];
    mockUseRun.mockReturnValue({ data: { run, artifacts, events: [] }, loading: false, error: null, refetch });
    renderPage();

    fireEvent.click(screen.getByText("submit-questions"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("passes active-process output through to AgentOutputPanel", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({ data: { run, artifacts: [], events: [] }, loading: false, error: null, refetch: vi.fn() });
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "build output here",
      activeProcessId: null,
    });
    renderPage();

    expect(screen.getByTestId("agent-output-panel").textContent).toBe("build output here");
  });

  it("shows the DistilledSkillPanel loading state while skills are loading", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({ data: { run, artifacts: [], events: [] }, loading: false, error: null, refetch: vi.fn() });
    mockUseRunSkills.mockReturnValue({ data: null, loading: true, error: null });
    renderPage();

    expect(screen.getByTestId("distilled-skill-panel").textContent).toBe("loading");
  });

  it("shows the DistilledSkillPanel error state on skills fetch failure", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({ data: { run, artifacts: [], events: [] }, loading: false, error: null, refetch: vi.fn() });
    mockUseRunSkills.mockReturnValue({ data: null, loading: false, error: "skills failed" });
    renderPage();

    expect(screen.getByTestId("distilled-skill-panel").textContent).toBe("skills failed");
  });

  it("calls scrollIntoView when the ActionBar requests scrolling to questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: { openQuestions: [{ id: "q1", question: "Q", requiredForExecution: true }] },
        rawText: "",
        createdAt: "",
      },
    ];
    mockUseRun.mockReturnValue({ data: { run, artifacts, events: [] }, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    const scrollIntoViewMock = vi.fn();
    HTMLDivElement.prototype.scrollIntoView = scrollIntoViewMock;

    fireEvent.click(screen.getByText("scroll-to-questions"));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("does not render optional links (PR, branch actions) when the run lacks that data", () => {
    const run = makeRun({
      branchName: null,
      prNumber: null,
      linearIssueUrl: null,
      workingDirectory: "",
    });
    mockUseRun.mockReturnValue({ data: { run, artifacts: [], events: [] }, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.queryByRole("link", { name: /Linear/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /PR #/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Cursor/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Claude Code/i })).toBeNull();
  });
});
