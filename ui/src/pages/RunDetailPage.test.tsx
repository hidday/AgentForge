import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";

// --- Mock the hooks the page depends on ---
const mockUseRun = vi.fn();
vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (...args: unknown[]) => mockUseRun(...args),
}));

const mockUseActiveProcesses = vi.fn();
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (...args: unknown[]) => mockUseActiveProcesses(...args),
}));

const mockUseRunSkills = vi.fn();
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (...args: unknown[]) => mockUseRunSkills(...args),
}));

// --- Mock all child components with simple stubs exposing their props ---
vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: (props: { state: string }) => (
    <div data-testid="state-badge">{props.state}</div>
  ),
}));

vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: (props: { currentState: string; events: RunEventRecord[] }) => (
    <div data-testid="workflow-stepper">
      state:{props.currentState} events:{props.events.length}
    </div>
  ),
}));

vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: (props: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">artifacts:{props.artifacts.length}</div>
  ),
}));

vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: (props: { processes: unknown[]; output: string }) => (
    <div data-testid="agent-output-panel">
      processes:{props.processes.length} output:{props.output}
    </div>
  ),
}));

vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: (props: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">events:{props.events.length}</div>
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
    <div data-testid="action-bar">
      runId:{props.runId} state:{props.state} hasOptionalQuestions:
      {String(props.hasOptionalQuestions)}
      <button onClick={props.onAction}>trigger-onAction</button>
      <button onClick={props.onScrollToQuestions}>trigger-scroll</button>
    </div>
  ),
}));

vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: {
    questions: OpenQuestion[];
    runId: string;
    readOnly: boolean;
    runState?: string;
    onSubmitted?: () => void;
  }) => (
    <div data-testid="open-questions-panel">
      runId:{props.runId} runState:{props.runState} count:
      {props.questions.length} readOnly:{String(props.readOnly)}
      <button onClick={props.onSubmitted}>trigger-onSubmitted</button>
    </div>
  ),
}));

vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: (props: { runId: string; artifacts: Artifact[] }) => (
    <div data-testid="chat-panel">
      runId:{props.runId} artifacts:{props.artifacts.length}
    </div>
  ),
}));

vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: (props: {
    distilledSkill: unknown;
    distillationDecision: unknown;
    loading: boolean;
    error: string | null;
  }) => (
    <div data-testid="distilled-skill-panel">
      loading:{String(props.loading)} error:{props.error ?? "none"}{" "}
      hasSkill:{String(props.distilledSkill !== null)} hasDecision:
      {String(props.distillationDecision !== null)}
    </div>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-12345678-abcd",
    linearIssueId: "issue-abcdefgh",
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
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-12345678-abcd",
    type: "Other",
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
    runId: "run-12345678-abcd",
    eventType: "state-changed",
    source: "system",
    payloadJson: {},
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultActiveProcesses = { processes: [], hasActive: false, output: "", activeProcessId: null };
const defaultSkills = { data: null, loading: false, error: null, refetch: vi.fn() };

function renderPage(id = "run-12345678-abcd") {
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
    mockUseActiveProcesses.mockReturnValue(defaultActiveProcesses);
    mockUseRunSkills.mockReturnValue(defaultSkills);
  });

  it("renders the loading state and does not render run content", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("renders the error message when the hook returns an error", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Failed to fetch run",
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Failed to fetch run")).toBeDefined();
  });

  it("renders a 'Run not found' fallback when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("passes the useParams id through to useRun, useRunSkills and useActiveProcesses", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage("run-xyz");

    expect(mockUseRun).toHaveBeenCalledWith("run-xyz");
    expect(mockUseRunSkills).toHaveBeenCalledWith("run-xyz");
    expect(mockUseActiveProcesses).toHaveBeenCalledWith("run-xyz");
  });

  it("renders run header details: id, issue title, repo and state badge", () => {
    const run = makeRun({
      id: "run-12345678-abcd",
      linearIssueTitle: "Fix the thing",
      repo: "org/repo",
      state: "Implementing",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("run-1234")).toBeDefined(); // slice(0,8)
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
  });

  it("falls back to linearIssueIdentifier, then linearIssueId, when title is absent", () => {
    const runWithIdentifier = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-42" });
    mockUseRun.mockReturnValue({
      data: { run: runWithIdentifier, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { unmount } = renderPage();
    expect(screen.getByText("ENG-42")).toBeDefined();
    unmount();

    const runWithNeither = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "issue-abcdefgh",
    });
    mockUseRun.mockReturnValue({
      data: { run: runWithNeither, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("issue-ab")).toBeDefined(); // slice(0,8)
  });

  it("renders the Linear link only when linearIssueUrl is set", () => {
    const runWithUrl = makeRun({ linearIssueUrl: "https://linear.app/issue/1" });
    mockUseRun.mockReturnValue({
      data: { run: runWithUrl, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { unmount } = renderPage();
    const link = screen.getByRole("link", { name: /linear/i });
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/1");
    unmount();

    mockUseRun.mockReturnValue({
      data: { run: makeRun({ linearIssueUrl: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole("link", { name: /linear/i })).toBeNull();
  });

  it("renders branch name only when set", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ branchName: "feature/foo" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { unmount } = renderPage();
    expect(screen.getByText("feature/foo")).toBeDefined();
    unmount();

    mockUseRun.mockReturnValue({
      data: { run: makeRun({ branchName: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByText("feature/foo")).toBeNull();
  });

  it("renders PR link only when prNumber is set, with correct GitHub URL", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ prNumber: 42, repo: "org/repo" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { unmount } = renderPage();
    const prLink = screen.getByRole("link", { name: /pr #42/i });
    expect(prLink.getAttribute("href")).toBe("https://github.com/org/repo/pull/42");
    unmount();

    mockUseRun.mockReturnValue({
      data: { run: makeRun({ prNumber: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole("link", { name: /pr #/i })).toBeNull();
  });

  it("renders Cursor / Claude Code / Claude links only when both branchName and workingDirectory are set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ branchName: "feature/foo", workingDirectory: "/tmp/work dir" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { unmount } = renderPage();
    const cursorLink = screen.getByRole("link", { name: /cursor/i });
    expect(cursorLink.getAttribute("href")).toBe("cursor://file/tmp/work dir");
    const claudeCliLink = screen.getByRole("link", { name: /claude code/i });
    expect(claudeCliLink.getAttribute("href")).toBe(
      `claude-cli://open?cwd=${encodeURIComponent("/tmp/work dir")}`,
    );
    const claudeDesktopLink = screen.getByRole("link", { name: /^claude$/i });
    expect(claudeDesktopLink.getAttribute("href")).toBe(
      `claude://code/new?folder=${encodeURIComponent("/tmp/work dir")}`,
    );
    unmount();

    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ branchName: null, workingDirectory: "/tmp/work" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole("link", { name: /cursor/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /claude code/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^claude$/i })).toBeNull();
  });

  it("passes run.state and events down to WorkflowStepper and EventTimeline", () => {
    const events = [makeEvent({ id: "e1" }), makeEvent({ id: "e2" })];
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "AIReview" }), artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("workflow-stepper").textContent).toBe(
      "state:AIReview events:2",
    );
    expect(screen.getByTestId("event-timeline").textContent).toBe("events:2");
  });

  it("passes artifacts to ArtifactTabs and ChatPanel", () => {
    const artifacts = [makeArtifact({ id: "a1" }), makeArtifact({ id: "a2" })];
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("artifacts:2");
    expect(screen.getByTestId("chat-panel").textContent).toContain("artifacts:2");
  });

  it("passes active-processes output down to AgentOutputPanel", () => {
    mockUseActiveProcesses.mockReturnValue({
      processes: [{ id: "p1" }],
      hasActive: true,
      output: "some output",
      activeProcessId: "p1",
    });
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("agent-output-panel").textContent).toBe(
      "processes:1 output:some output",
    );
  });

  it("passes distilled skill data, loading and error to DistilledSkillPanel", () => {
    mockUseRunSkills.mockReturnValue({
      data: {
        injectedSkills: [],
        distillationDecision: { shouldPersist: true, reason: "r", taskCategory: null, name: null, description: null, displacedSkillId: null },
        distilledSkill: { id: "s1", repoSlug: "org/repo", name: "Skill", description: null, taskCategory: "cat", skillMarkdown: "md", utilityScore: 1, lastUsedAt: "2024-01-01T00:00:00Z" },
      },
      loading: false,
      error: "Some skill error",
      refetch: vi.fn(),
    });
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const panel = screen.getByTestId("distilled-skill-panel");
    expect(panel.textContent).toContain("loading:false");
    expect(panel.textContent).toContain("error:Some skill error");
    expect(panel.textContent).toContain("hasSkill:true");
    expect(panel.textContent).toContain("hasDecision:true");
  });

  it("defaults DistilledSkillPanel skill/decision to null when skillsData is null", () => {
    mockUseRunSkills.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const panel = screen.getByTestId("distilled-skill-panel");
    expect(panel.textContent).toContain("loading:true");
    expect(panel.textContent).toContain("hasSkill:false");
    expect(panel.textContent).toContain("hasDecision:false");
  });

  it("shows the required OpenQuestionsPanel when state is HumanClarificationNeeded and there are open questions from the Plan artifact", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "What env?", requiredForExecution: true },
      { id: "q2", question: "Optional?", requiredForExecution: false },
    ];
    const planArtifact = makeArtifact({
      id: "plan-1",
      type: "Plan",
      payloadJson: { openQuestions: questions },
    });
    mockUseRun.mockReturnValue({
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

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.textContent).toContain("count:2");
    expect(panel.textContent).toContain("readOnly:false");
    expect(panel.textContent).toContain("runState:HumanClarificationNeeded");
  });

  it("does not show the OpenQuestionsPanel in HumanClarificationNeeded state when there are no open questions", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("shows only optional questions in the secondary panel when state is AwaitingPlanApproval", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required one", requiredForExecution: true },
      { id: "q2", question: "Optional one", requiredForExecution: false },
      { id: "q3", question: "Another optional", requiredForExecution: false },
    ];
    const planArtifact = makeArtifact({
      id: "plan-1",
      type: "Plan",
      payloadJson: { openQuestions: questions },
    });
    mockUseRun.mockReturnValue({
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

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.textContent).toContain("count:2");

    // ActionBar reflects hasOptionalQuestions
    expect(screen.getByTestId("action-bar").textContent).toContain(
      "hasOptionalQuestions:true",
    );
  });

  it("does not show the optional-questions panel in AwaitingPlanApproval when there are none", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required one", requiredForExecution: true },
    ];
    const planArtifact = makeArtifact({
      id: "plan-1",
      type: "Plan",
      payloadJson: { openQuestions: questions },
    });
    mockUseRun.mockReturnValue({
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

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("action-bar").textContent).toContain(
      "hasOptionalQuestions:false",
    );
  });

  it("handles a missing Plan artifact and a Plan artifact without openQuestions gracefully", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [makeArtifact({ type: "Plan", payloadJson: {} })],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("does not render either OpenQuestionsPanel for other states, even with open questions present", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Q", requiredForExecution: false },
    ];
    const planArtifact = makeArtifact({ type: "Plan", payloadJson: { openQuestions: questions } });
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "Implementing" }), artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("calls refetch when the OpenQuestionsPanel's onSubmitted fires", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Q", requiredForExecution: true },
    ];
    const planArtifact = makeArtifact({ type: "Plan", payloadJson: { openQuestions: questions } });
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "trigger-onSubmitted" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("calls refetch when ActionBar's onAction fires, and passes runId/state through", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ id: "run-999", state: "Implementing" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    const actionBar = screen.getByTestId("action-bar");
    expect(actionBar.textContent).toContain("runId:run-999");
    expect(actionBar.textContent).toContain("state:Implementing");

    await user.click(screen.getByRole("button", { name: "trigger-onAction" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("scrolls the open-questions ref into view when ActionBar's onScrollToQuestions fires", async () => {
    const user = userEvent.setup();
    const scrollIntoViewMock = vi.fn();
    // jsdom doesn't implement scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const questions: OpenQuestion[] = [
      { id: "q1", question: "Q", requiredForExecution: true },
    ];
    const planArtifact = makeArtifact({ type: "Plan", payloadJson: { openQuestions: questions } });
    mockUseRun.mockReturnValue({
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

    await user.click(screen.getByRole("button", { name: "trigger-scroll" }));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("does not throw when onScrollToQuestions fires and the questions ref was never attached (no panel rendered)", async () => {
    const user = userEvent.setup();
    const scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "Implementing" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "trigger-scroll" }));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("renders the back-to-dashboard link pointing at '/'", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const backLink = screen.getByRole("link", { name: "" });
    expect(backLink.getAttribute("href")).toBe("/");
  });

  it("renders the formatted created-at timestamp", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ createdAt: "2024-01-01T00:00:00Z" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText(/^Created/)).toBeDefined();
  });
});
