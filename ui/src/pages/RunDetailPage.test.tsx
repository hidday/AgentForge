import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useParams: () => ({ id: "run-1" }) };
});

const mockUseRun = vi.fn();
const mockUseActiveProcesses = vi.fn();
const mockUseRunSkills = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: () => mockUseRun() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: () => mockUseActiveProcesses(),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: () => mockUseRunSkills() }));

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
    <div data-testid="agent-output-panel">{output}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length}</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    state,
    hasOptionalQuestions,
    onScrollToQuestions,
  }: {
    state: string;
    hasOptionalQuestions?: boolean;
    onScrollToQuestions?: () => void;
  }) => (
    <div data-testid="action-bar">
      <span data-testid="action-bar-state">{state}</span>
      <span data-testid="action-bar-has-optional">{String(hasOptionalQuestions)}</span>
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({
    questions,
  }: {
    questions: Array<{ id: string; question: string }>;
  }) => (
    <div data-testid="open-questions-panel">
      {questions.map((q) => (
        <span key={q.id}>{q.question}</span>
      ))}
    </div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: ({ runId }: { runId: string }) => (
    <div data-testid="chat-panel">{runId}</div>
  ),
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: ({
    distilledSkill,
    loading,
    error,
  }: {
    distilledSkill: unknown;
    loading?: boolean;
    error?: string | null;
  }) => (
    <div data-testid="distilled-skill-panel">
      {String(distilledSkill)}|{String(loading)}|{String(error)}
    </div>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1-full-uuid",
    linearIssueId: "issue-1-full-uuid",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
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
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-1"]}>
      <RunDetailPage />
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveProcesses.mockReturnValue({ processes: [], output: "" });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows the error message when the run fails to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Network error",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("shows a fallback message when there is no error but no data either", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details: id, issue title, repo, and state", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("run-1-fu")).toBeDefined(); // id.slice(0, 8)
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
  });

  it("falls back to linearIssueIdentifier, then a truncated id, when title is absent", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: null }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("issue-1-")).toBeDefined();
  });

  it("shows the Linear link only when linearIssueUrl is present", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ linearIssueUrl: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { rerender } = renderPage();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();

    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ linearIssueUrl: "https://linear.app/x" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    rerender(
      <MemoryRouter initialEntries={["/runs/run-1"]}>
        <RunDetailPage />
      </MemoryRouter>,
    );
    expect(screen.getByTitle("Open in Linear").getAttribute("href")).toBe(
      "https://linear.app/x",
    );
  });

  it("shows PR, branch, Cursor, Claude Code, and Claude links when branch + working directory are set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({
          branchName: "feature/x",
          workingDirectory: "/repo/worktree",
          prNumber: 77,
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("feature/x")).toBeDefined();
    expect(screen.getByTitle("Open PR on GitHub").getAttribute("href")).toBe(
      "https://github.com/acme/widgets/pull/77",
    );
    expect(screen.getByTitle("Open in Cursor").getAttribute("href")).toBe(
      "cursor://file/repo/worktree",
    );
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });

  it("hides branch/PR/editor links when branchName or workingDirectory is absent", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ branchName: null, workingDirectory: "", prNumber: null }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("passes artifacts and events counts down to ArtifactTabs and EventTimeline", () => {
    const artifacts: Artifact[] = [
      { id: "a1", runId: "run-1", type: "Plan", version: 1, payloadJson: {}, rawText: "", createdAt: "2024-01-01" },
    ];
    const events: RunEventRecord[] = [
      { id: "e1", runId: "run-1", eventType: "RUN_REQUESTED", source: "api", payloadJson: {}, createdAt: "2024-01-01" },
    ];
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
    expect(screen.getByTestId("workflow-stepper").textContent).toBe("Implementing");
  });

  it("shows OpenQuestionsPanel with all open questions when HumanClarificationNeeded", () => {
    const planArtifact: Artifact = {
      id: "plan-1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required Q", requiredForExecution: true },
          { id: "q2", question: "Optional Q", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01",
    };
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
    expect(panel.textContent).toContain("Required Q");
    expect(panel.textContent).toContain("Optional Q");
  });

  it("shows OpenQuestionsPanel with only optional questions when AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "plan-1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required Q", requiredForExecution: true },
          { id: "q2", question: "Optional Q", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01",
    };
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
    expect(panel.textContent).toContain("Optional Q");
    expect(panel.textContent).not.toContain("Required Q");
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("true");
  });

  it("does not show OpenQuestionsPanel when there is no Plan artifact", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "HumanClarificationNeeded" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("false");
  });

  it("scrolls the questions panel into view when ActionBar triggers onScrollToQuestions", async () => {
    const scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const planArtifact: Artifact = {
      id: "plan-1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Required Q", requiredForExecution: true }],
      },
      rawText: "",
      createdAt: "2024-01-01",
    };
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

    await userEvent.click(screen.getByText("scroll-to-questions"));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("passes the skills data, loading, and error state to DistilledSkillPanel", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: true,
      error: "skills error",
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("distilled-skill-panel").textContent).toBe(
      "null|true|skills error",
    );
  });

  it("always renders the ChatPanel with the run id", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ id: "run-xyz" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("chat-panel").textContent).toBe("run-xyz");
  });

  it("passes agent output panel the live process output", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue({ processes: [], output: "streamed output" });
    renderPage();
    expect(screen.getByTestId("agent-output-panel").textContent).toBe("streamed output");
  });
});
