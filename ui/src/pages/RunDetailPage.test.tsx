import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RunDetailPage } from "./RunDetailPage";
import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));

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
let capturedScrollToQuestions: (() => void) | undefined;
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    state,
    hasOptionalQuestions,
    onScrollToQuestions,
  }: {
    state: string;
    hasOptionalQuestions: boolean;
    onScrollToQuestions?: () => void;
  }) => {
    capturedScrollToQuestions = onScrollToQuestions;
    return (
      <div data-testid="action-bar">
        {state}:{String(hasOptionalQuestions)}
      </div>
    );
  },
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: unknown[] }) => (
    <div data-testid="open-questions">{questions.length}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-12345678",
    linearIssueId: "issue-12345678",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
    branchName: "fix/bug",
    prNumber: 7,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "a1",
    runId: "run-12345678",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-12345678"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.mocked(useRunSkills).mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(useActiveProcesses).mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
  });

  it("shows a loading state while the run is being fetched", () => {
    vi.mocked(useRun).mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows an error message when the run fails to load", () => {
    vi.mocked(useRun).mockReturnValue({
      data: null,
      loading: false,
      error: "network down",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("network down")).toBeDefined();
  });

  it("shows a not-found fallback when there is no error but also no data", () => {
    vi.mocked(useRun).mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details once loaded", () => {
    vi.mocked(useRun).mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("fix/bug")).toBeDefined();
    expect(screen.getByText("PR #7")).toBeDefined();
    expect(screen.getByText("Cursor")).toBeDefined();
    expect(screen.getByText("Claude Code")).toBeDefined();
    expect(screen.getByText("Claude")).toBeDefined();
  });

  it("falls back to the issue identifier and omits optional links when absent", () => {
    vi.mocked(useRun).mockReturnValue({
      data: {
        run: makeRun({
          linearIssueTitle: null,
          linearIssueUrl: null,
          branchName: null,
          prNumber: null,
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("ENG-1")).toBeDefined();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByText("Cursor")).toBeNull();
    expect(screen.queryByText(/PR #/)).toBeNull();
  });

  it("falls back to a truncated issue id when neither title nor identifier is set", () => {
    vi.mocked(useRun).mockReturnValue({
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
    expect(screen.getByText("issue-12")).toBeDefined();
  });

  it("shows the open questions panel when human clarification is needed", () => {
    vi.mocked(useRun).mockReturnValue({
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
      refetch: vi.fn(),
    });
    renderPage();
    const panels = screen.getAllByTestId("open-questions");
    expect(panels[0]!.textContent).toBe("2");
    expect(screen.getByTestId("action-bar").textContent).toBe(
      "HumanClarificationNeeded:true",
    );
  });

  it("shows only optional questions when awaiting plan approval", () => {
    vi.mocked(useRun).mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
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
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("open-questions").textContent).toBe("1");
    expect(screen.getByTestId("action-bar").textContent).toBe(
      "AwaitingPlanApproval:true",
    );
  });

  it("does not render the questions panel when there is no Plan artifact", () => {
    vi.mocked(useRun).mockReturnValue({
      data: { run: makeRun({ state: "HumanClarificationNeeded" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions")).toBeNull();
  });

  it("passes artifacts and events through to child panels", () => {
    vi.mocked(useRun).mockReturnValue({
      data: {
        run: makeRun(),
        artifacts: [makeArtifact(), makeArtifact({ id: "a2" })],
        events: [{ id: "e1", runId: "run-12345678", eventType: "RUN_REQUESTED", source: "system", payloadJson: null, createdAt: "2026-01-01T00:00:00.000Z" }],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("2");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
  });

  it("scrolls the questions panel into view when the action bar requests it", () => {
    vi.mocked(useRun).mockReturnValue({
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
      refetch: vi.fn(),
    });
    renderPage();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    capturedScrollToQuestions!();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});
