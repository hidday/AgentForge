import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

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

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <div data-testid="state-badge">{state}</div>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: ({ currentState }: { currentState: string }) => (
    <div data-testid="workflow-stepper">{currentState}</div>
  ),
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs" data-count={artifacts.length} />
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: ({ output }: { output: string }) => (
    <div data-testid="agent-output-panel">{output}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline" data-count={events.length} />
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    runId,
    state,
    onAction,
    onScrollToQuestions,
    hasOptionalQuestions,
  }: {
    runId: string;
    state: string;
    onAction: () => void;
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  }) => (
    <div data-testid="action-bar" data-run-id={runId} data-state={state}>
      <button data-testid="action-bar-action" onClick={onAction}>
        act
      </button>
      <button data-testid="action-bar-scroll" onClick={onScrollToQuestions}>
        scroll
      </button>
      <span data-testid="action-bar-has-optional">{String(hasOptionalQuestions)}</span>
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
    <div data-testid="open-questions-panel" data-count={questions.length}>
      <button data-testid="open-questions-submit" onClick={onSubmitted}>
        submit
      </button>
    </div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: ({ runId }: { runId: string }) => (
    <div data-testid="chat-panel" data-run-id={runId} />
  ),
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: ({ loading, error }: { loading: boolean; error: string | null }) => (
    <div data-testid="distilled-skill-panel" data-loading={loading} data-error={error ?? ""} />
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-123456789",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
    branchName: "feature/fix",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
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
    id: "a1",
    runId: "run-123456789",
    type: "SomeArtifact",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const refetch = vi.fn();

function renderAt(id = "run-123456789") {
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
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch,
    });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: false,
      error: null,
    });
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      output: "",
    });
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch });
    renderAt();
    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("shows an error message when the run fails to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run fetch failed",
      refetch,
    });
    renderAt();
    expect(screen.getByText("Run fetch failed")).toBeDefined();
  });

  it("shows a fallback 'Run not found' message when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch });
    renderAt();
    expect(screen.getByText(/run not found/i)).toBeDefined();
  });

  it("renders run metadata: id, issue title, repo, branch, state badge, and timestamp", () => {
    renderAt();
    expect(screen.getByText("run-1234")).toBeDefined(); // first 8 chars
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("feature/fix")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByText(/pr #42/i)).toBeDefined();
    expect(screen.getByText(/linear/i).closest("a")).toHaveProperty(
      "href",
      "https://linear.app/issue/ENG-1",
    );
  });

  it("falls back to linearIssueIdentifier, then linearIssueId, when no title is present", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when neither title nor identifier exist", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueTitle: null,
          linearIssueIdentifier: null,
          linearIssueId: "abcdefghij",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("does not render the Linear link, branch, PR, or editor links when absent", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueUrl: null,
          branchName: null,
          prNumber: null,
          workingDirectory: "",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    expect(screen.queryByText(/^Linear$/i)).toBeNull();
    expect(screen.queryByText(/pr #/i)).toBeNull();
    expect(screen.queryByText(/cursor/i)).toBeNull();
    expect(screen.queryByText(/claude code/i)).toBeNull();
  });

  it("renders editor deep links (Cursor, Claude Code, Claude) when branch and workingDirectory are present", () => {
    renderAt();
    const cursorLink = screen.getByText(/^Cursor$/i).closest("a");
    expect(cursorLink?.getAttribute("href")).toBe("cursor://file/tmp/work");

    const claudeCodeLink = screen.getByText(/^Claude Code$/i).closest("a");
    expect(claudeCodeLink?.getAttribute("href")).toBe(
      "claude-cli://open?cwd=" + encodeURIComponent("/tmp/work"),
    );

    const claudeLink = screen.getByText(/^Claude$/i).closest("a");
    expect(claudeLink?.getAttribute("href")).toBe(
      "claude://code/new?folder=" + encodeURIComponent("/tmp/work"),
    );
  });

  it("passes artifacts and events through to ArtifactTabs and EventTimeline", () => {
    const artifacts = [makeArtifact({ id: "a1" }), makeArtifact({ id: "a2" })];
    const events: RunEventRecord[] = [
      { id: "e1", runId: "run-123456789", eventType: "x", source: "s", payloadJson: {}, createdAt: "2024-01-01T00:00:00Z" },
    ];
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts, events },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    expect(screen.getByTestId("artifact-tabs").getAttribute("data-count")).toBe("2");
    expect(screen.getByTestId("event-timeline").getAttribute("data-count")).toBe("1");
  });

  it("passes active process output through to AgentOutputPanel", () => {
    mockUseActiveProcesses.mockReturnValue({
      processes: [{ id: "p1" }],
      output: "some output",
    });
    renderAt();
    expect(screen.getByTestId("agent-output-panel").textContent).toBe("some output");
  });

  it("passes skills loading/error state through to DistilledSkillPanel", () => {
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: true,
      error: "skills failed",
    });
    renderAt();
    const panel = screen.getByTestId("distilled-skill-panel");
    expect(panel.getAttribute("data-loading")).toBe("true");
    expect(panel.getAttribute("data-error")).toBe("skills failed");
  });

  it("shows the OpenQuestionsPanel with all open questions when state is HumanClarificationNeeded", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [
          makeArtifact({
            type: "Plan",
            payloadJson: {
              openQuestions: [
                { id: "q1", question: "A?", requiredForExecution: true },
                { id: "q2", question: "B?", requiredForExecution: false },
              ],
            },
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    expect(screen.getByTestId("open-questions-panel").getAttribute("data-count")).toBe("2");
  });

  it("does not show the required-questions panel outside HumanClarificationNeeded", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "Implementing" }),
        artifacts: [
          makeArtifact({
            type: "Plan",
            payloadJson: {
              openQuestions: [{ id: "q1", question: "A?", requiredForExecution: true }],
            },
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("shows only optional (non-required) questions when state is AwaitingPlanApproval", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [
          makeArtifact({
            type: "Plan",
            payloadJson: {
              openQuestions: [
                { id: "q1", question: "Required", requiredForExecution: true },
                { id: "q2", question: "Optional1", requiredForExecution: false },
                { id: "q3", question: "Optional2", requiredForExecution: false },
              ],
            },
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    expect(screen.getByTestId("open-questions-panel").getAttribute("data-count")).toBe("2");
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("true");
  });

  it("hides the optional-questions panel in AwaitingPlanApproval when there are none", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [
          makeArtifact({
            type: "Plan",
            payloadJson: { openQuestions: [{ id: "q1", question: "Required", requiredForExecution: true }] },
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("false");
  });

  it("handles the absence of any Plan artifact without crashing (no open questions)", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("OpenQuestionsPanel onSubmitted triggers refetch", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [
          makeArtifact({
            type: "Plan",
            payloadJson: {
              openQuestions: [{ id: "q1", question: "A?", requiredForExecution: true }],
            },
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    screen.getByTestId("open-questions-submit").click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("ActionBar onAction triggers refetch and receives runId/state", () => {
    renderAt();
    const bar = screen.getByTestId("action-bar");
    expect(bar.getAttribute("data-run-id")).toBe("run-123456789");
    expect(bar.getAttribute("data-state")).toBe("Implementing");
    screen.getByTestId("action-bar-action").click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("ActionBar onScrollToQuestions calls scrollIntoView on the questions container", () => {
    const scrollIntoView = vi.fn();
    HTMLDivElement.prototype.scrollIntoView = scrollIntoView;
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [
          makeArtifact({
            type: "Plan",
            payloadJson: {
              openQuestions: [{ id: "q1", question: "A?", requiredForExecution: true }],
            },
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch,
    });
    renderAt();
    screen.getByTestId("action-bar-scroll").click();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("ActionBar onScrollToQuestions is a no-op (no throw) when the questions ref is unset", () => {
    renderAt(); // state is "Implementing", no questions panel rendered -> ref never attached
    expect(() => screen.getByTestId("action-bar-scroll").click()).not.toThrow();
  });

  it("passes runId through to ChatPanel", () => {
    renderAt();
    expect(screen.getByTestId("chat-panel").getAttribute("data-run-id")).toBe("run-123456789");
  });
});
