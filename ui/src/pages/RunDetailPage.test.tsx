import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));

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
    <div data-testid="artifact-tabs">{artifacts.length} artifacts</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: ({ output }: { output: string }) => (
    <div data-testid="agent-output">{output}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length} events</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ state, hasOptionalQuestions }: { state: string; hasOptionalQuestions: boolean }) => (
    <div data-testid="action-bar">
      {state} / optional:{String(hasOptionalQuestions)}
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: OpenQuestion[] }) => (
    <div data-testid="open-questions">{questions.length} questions</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
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
    linearIssueTitle: "Fix bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
    branchName: "feature/fix-bug",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderAtRun(id = "run-1234567890") {
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
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });

    renderAtRun();

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("workflow-stepper")).toBeNull();
  });

  it("shows an error message when the hook reports an error", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run not found",
      refetch: vi.fn(),
    });

    renderAtRun();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it('shows a generic "Run not found" message when there is no error but also no data', () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });

    renderAtRun();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run header and detail panels once data has loaded", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRun();

    expect(screen.getByText("Fix bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("feature/fix-bug")).toBeDefined();
    expect(screen.getByText(/PR #42/)).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTestId("workflow-stepper").textContent).toBe("Implementing");
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("0 artifacts");
    expect(screen.getByTestId("event-timeline").textContent).toBe("0 events");
    expect(screen.getByTestId("action-bar")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
  });

  it("falls back to the issue identifier when there is no linear issue title", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRun();

    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("shows the required open-questions panel when HumanClarificationNeeded and questions exist", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "What auth method?", requiredForExecution: true },
      { id: "q2", question: "Optional detail?", requiredForExecution: false },
    ];
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { openQuestions: questions },
      rawText: "",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const run = makeRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRun();

    // All open questions (both required and optional) are shown in this state.
    expect(screen.getByTestId("open-questions").textContent).toBe("2 questions");
  });

  it("shows only optional open questions when AwaitingPlanApproval", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required one", requiredForExecution: true },
      { id: "q2", question: "Optional one", requiredForExecution: false },
      { id: "q3", question: "Another optional", requiredForExecution: false },
    ];
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: { openQuestions: questions },
      rawText: "",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const run = makeRun({ state: "AwaitingPlanApproval" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRun();

    expect(screen.getByTestId("open-questions").textContent).toBe("2 questions");
    expect(screen.getByTestId("action-bar").textContent).toContain("optional:true");
  });

  it("does not render an open-questions panel in states without applicable questions", () => {
    const run = makeRun({ state: "Implementing" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRun();

    expect(screen.queryByTestId("open-questions")).toBeNull();
    expect(screen.getByTestId("action-bar").textContent).toContain("optional:false");
  });

  it("omits branch/PR/editor links when the run has no branch name", () => {
    const run = makeRun({ branchName: null, prNumber: null, workingDirectory: "/tmp/x" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRun();

    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("omits the Linear link when the run has no linearIssueUrl", () => {
    const run = makeRun({ linearIssueUrl: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtRun();

    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });
});
