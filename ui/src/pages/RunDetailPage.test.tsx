import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const mockUseRun = vi.fn();
const mockUseRunSkills = vi.fn();
const mockUseActiveProcesses = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: (id: string) => mockUseRun(id) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => mockUseRunSkills(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => mockUseActiveProcesses(id),
}));

// Heavy child panels are covered by their own test suites; stub them here so
// RunDetailPage tests stay focused on composition/wiring logic.
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">artifacts:{artifacts.length}</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">events:{events.length}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: {
    questions: Array<{ id: string; requiredForExecution: boolean }>;
    readOnly: boolean;
    runState?: string;
  }) => (
    <div data-testid="open-questions-panel">
      count:{props.questions.length} readOnly:{String(props.readOnly)} state:
      {props.runState}
    </div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: {
    runId: string;
    state: string;
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  }) => (
    <div data-testid="action-bar">
      <span data-testid="action-bar-state">{props.state}</span>
      <span data-testid="action-bar-has-optional">
        {String(props.hasOptionalQuestions)}
      </span>
      {props.onScrollToQuestions && (
        <button onClick={props.onScrollToQuestions}>scroll-to-questions</button>
      )}
    </div>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "11112222-3333-4444-5555-666677778888",
    linearIssueId: "issue-abcdef12",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the widget",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "acme/widgets",
    branchName: "agent/eng-1",
    prNumber: 7,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/eng-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePlanArtifact(
  openQuestions: Array<{ id: string; question: string; requiredForExecution: boolean }>,
): Artifact {
  return {
    id: "artifact-plan",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: { openQuestions },
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

function renderAtRunId(id: string) {
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
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: false,
      error: null,
    });
    mockUseActiveProcesses.mockReturnValue({ processes: [], output: "" });
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderAtRunId("run-1");
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows the error message when loading fails", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run fetch failed",
      refetch: vi.fn(),
    });
    renderAtRunId("run-1");
    expect(screen.getByText("Run fetch failed")).toBeDefined();
  });

  it("shows a generic 'Run not found' message when there is no error but no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderAtRunId("run-1");
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details: issue link, repo, branch, PR link, and state badge", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId("run-1");

    expect(screen.getByText("Fix the widget")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("agent/eng-1")).toBeDefined();
    expect(screen.getByText("PR #7")).toBeDefined();
    // "Implementing" also appears in the stubbed ActionBar's state span, so
    // find the specific StateBadge rendering of it.
    const stateLabels = screen.getAllByText("Implementing");
    expect(
      stateLabels.some((el) => el.className.includes("state-active")),
    ).toBe(true);

    const linearLink = screen.getByText("Linear").closest("a");
    expect(linearLink?.getAttribute("href")).toBe("https://linear.app/team/issue/ENG-1");

    const prLink = screen.getByText("PR #7").closest("a");
    expect(prLink?.getAttribute("href")).toBe("https://github.com/acme/widgets/pull/7");
  });

  it("omits branch/PR/editor links when the run has no branch or PR", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ branchName: null, prNumber: null, linearIssueUrl: null }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId("run-1");

    expect(screen.queryByText(/^PR #/)).toBeNull();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("passes artifacts and events down to ArtifactTabs and EventTimeline", () => {
    const artifacts = [makePlanArtifact([])];
    const events: RunEventRecord[] = [
      { id: "e1", runId: "run-1", eventType: "run:state-changed", source: "system", payloadJson: {}, createdAt: "2024-01-01T00:00:00Z" },
    ];
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId("run-1");

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("artifacts:1");
    expect(screen.getByTestId("event-timeline").textContent).toBe("events:1");
  });

  it("shows all open questions (required + optional) prominently when HumanClarificationNeeded", () => {
    const artifacts = [
      makePlanArtifact([
        { id: "q1", question: "Required Q", requiredForExecution: true },
        { id: "q2", question: "Optional Q", requiredForExecution: false },
      ]),
    ];
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts,
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId("run-1");

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.textContent).toContain("count:2");
    expect(panel.textContent).toContain("readOnly:false");
    expect(panel.textContent).toContain("state:HumanClarificationNeeded");
  });

  it("shows only optional questions as a secondary panel when AwaitingPlanApproval", () => {
    const artifacts = [
      makePlanArtifact([
        { id: "q1", question: "Required Q", requiredForExecution: true },
        { id: "q2", question: "Optional Q", requiredForExecution: false },
      ]),
    ];
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts,
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId("run-1");

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.textContent).toContain("count:1");
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("true");
  });

  it("does not render an OpenQuestionsPanel for states that don't need one", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "Implementing" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId("run-1");

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("false");
  });

  it("wires ActionBar's onScrollToQuestions to scroll the questions panel into view", async () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    try {
      const artifacts = [
        makePlanArtifact([{ id: "q1", question: "Optional Q", requiredForExecution: false }]),
      ];
      mockUseRun.mockReturnValue({
        data: {
          run: makeRun({ state: "AwaitingPlanApproval" }),
          artifacts,
          events: [],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderAtRunId("run-1");

      await userEvent.click(screen.getByText("scroll-to-questions"));
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("passes the run id and state through to ActionBar", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "AIReview" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtRunId("run-1");

    expect(screen.getByTestId("action-bar-state").textContent).toBe("AIReview");
  });
});
