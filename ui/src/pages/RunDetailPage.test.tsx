import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useParams: vi.fn(),
  };
});

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <span data-testid="state-badge">{state}</span>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: ({ currentState }: { currentState: string }) => (
    <div data-testid="workflow-stepper">{currentState}</div>
  ),
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{artifacts.length}</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: ({ output }: { output: string }) => (
    <div data-testid="agent-output">{output}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length}</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    onAction,
    onScrollToQuestions,
    hasOptionalQuestions,
  }: {
    onAction: () => void;
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  }) => (
    <div data-testid="action-bar" data-has-optional={String(!!hasOptionalQuestions)}>
      <button onClick={onAction}>action-bar-action</button>
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({
    questions,
    onSubmitted,
  }: {
    questions: { id: string }[];
    onSubmitted?: () => void;
  }) => (
    <div data-testid="open-questions-panel">
      <span data-testid="question-count">{questions.length}</span>
      <button onClick={onSubmitted}>submit-questions</button>
    </div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: ({ runId }: { runId: string }) => <div data-testid="chat-panel">{runId}</div>,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: ({ loading, error }: { loading?: boolean; error?: string | null }) => (
    <div data-testid="distilled-skill-panel">{loading ? "loading" : error ?? "ready"}</div>
  ),
}));

import { useParams } from "react-router-dom";
import { useRun } from "@/hooks/useRun.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { RunDetailPage } from "./RunDetailPage";

const mockUseParams = useParams as unknown as ReturnType<typeof vi.fn>;
const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-abcdef12",
    linearIssueId: "li-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePlanArtifact(openQuestions: { id: string; question: string; requiredForExecution: boolean }[]): Artifact {
  return {
    id: "art-1",
    runId: "run-abcdef12",
    type: "Plan",
    version: 1,
    payloadJson: { openQuestions },
    rawText: "",
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

const DEFAULT_SKILLS_HOOK = {
  data: null,
  loading: false,
  error: null,
  refetch: vi.fn(),
};
const DEFAULT_PROCESSES_HOOK = { processes: [], hasActive: false, output: "", activeProcessId: null };

function renderPage() {
  return render(
    <MemoryRouter>
      <RunDetailPage />
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  const refetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ id: "run-abcdef12" });
    mockUseActiveProcesses.mockReturnValue(DEFAULT_PROCESSES_HOOK);
    mockUseRunSkills.mockReturnValue(DEFAULT_SKILLS_HOOK);
  });

  it("reads the run id from route params and passes it to useRun/useRunSkills/useActiveProcesses", () => {
    mockUseParams.mockReturnValue({ id: "my-run-id" });
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch });
    renderPage();
    expect(mockUseRun).toHaveBeenCalledWith("my-run-id");
    expect(mockUseRunSkills).toHaveBeenCalledWith("my-run-id");
    expect(mockUseActiveProcesses).toHaveBeenCalledWith("my-run-id");
  });

  it("shows a loading state while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch });
    renderPage();
    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("workflow-stepper")).toBeNull();
  });

  it("shows the error message when the fetch failed", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: "network error", refetch });
    renderPage();
    expect(screen.getByText("network error")).toBeDefined();
  });

  it("shows 'Run not found' when there is no error but no data either", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run header and all main panels on success", () => {
    const run = makeRun({ linearIssueTitle: "Fix the bug", linearIssueUrl: "https://linear.app/issue/1" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [{ id: "e1" } as unknown as RunEventRecord] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    expect(screen.getByText("run-abcd")).toBeDefined(); // id.slice(0, 8)
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByRole("link", { name: /linear/i })).toHaveProperty(
      "href",
      "https://linear.app/issue/1",
    );
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Todo");
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("0");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
    expect(screen.getByTestId("agent-output")).toBeDefined();
    expect(screen.getByTestId("chat-panel").textContent).toBe(run.id);
    expect(screen.getByTestId("action-bar")).toBeDefined();
  });

  it("falls back to the Linear issue identifier, then the issue id, when there's no title", () => {
    const withIdentifier = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-42" });
    mockUseRun.mockReturnValue({
      data: { run: withIdentifier, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    const { rerender } = renderPage();
    expect(screen.getByText("ENG-42")).toBeDefined();

    const noIdentifier = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "deadbeef1234",
    });
    mockUseRun.mockReturnValue({
      data: { run: noIdentifier, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    rerender(
      <MemoryRouter>
        <RunDetailPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("deadbeef")).toBeDefined(); // linearIssueId.slice(0, 8)
  });

  it("does not render the Linear link when linearIssueUrl is absent", () => {
    const run = makeRun({ linearIssueUrl: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();
    expect(screen.queryByRole("link", { name: /linear/i })).toBeNull();
  });

  it("renders the branch name, PR link, and worktree-opener links only when present", () => {
    const run = makeRun({ branchName: "feature/foo", prNumber: 42, workingDirectory: "/tmp/work" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    expect(screen.getByText("feature/foo")).toBeDefined();
    const prLink = screen.getByRole("link", { name: /pr #42/i });
    expect(prLink).toHaveProperty("href", "https://github.com/org/repo/pull/42");
    expect(screen.getByRole("link", { name: /cursor/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /claude code/i })).toBeDefined();
    expect(screen.getByRole("link", { name: "Claude" })).toBeDefined();
  });

  it("omits branch/PR/worktree links when the run has no branch or PR", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();
    expect(screen.queryByRole("link", { name: /pr #/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /cursor/i })).toBeNull();
  });

  it("shows the required open-questions panel prominently in HumanClarificationNeeded", () => {
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
      refetch,
    });
    renderPage();

    // All open questions (required + optional) are shown here, not just optional ones
    expect(screen.getByTestId("question-count").textContent).toBe("2");
  });

  it("shows only optional open questions in AwaitingPlanApproval, and wires hasOptionalQuestions on the ActionBar", () => {
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
      refetch,
    });
    renderPage();

    expect(screen.getByTestId("question-count").textContent).toBe("1");
    expect(screen.getByTestId("action-bar").dataset.hasOptional).toBe("true");
  });

  it("renders no open-questions panel and hasOptionalQuestions=false when there is no Plan artifact", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("action-bar").dataset.hasOptional).toBe("false");
  });

  it("does not show the questions panel for other states even with open questions present", () => {
    const run = makeRun({ state: "Implementing" });
    const artifacts = [
      makePlanArtifact([{ id: "q1", question: "Required?", requiredForExecution: true }]),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("calls refetch when the ActionBar fires onAction and when OpenQuestionsPanel fires onSubmitted", async () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makePlanArtifact([{ id: "q1", question: "Required?", requiredForExecution: true }]),
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "action-bar-action" }));
    expect(refetch).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "submit-questions" }));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("scrolls the questions panel into view when the ActionBar requests it", async () => {
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
      refetch,
    });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "scroll-to-questions" }));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("passes active-process output and skills loading/error state down to child panels", () => {
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "some agent output",
      activeProcessId: null,
    });
    mockUseRunSkills.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    expect(screen.getByTestId("agent-output").textContent).toBe("some agent output");
    expect(screen.getByTestId("distilled-skill-panel").textContent).toBe("loading");
  });
});
