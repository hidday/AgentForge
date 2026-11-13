import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
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

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <span data-testid="state-badge">{state}</span>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: () => <div data-testid="workflow-stepper" />,
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{artifacts.length}</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ hasOptionalQuestions }: { hasOptionalQuestions?: boolean }) => (
    <div data-testid="action-bar" data-has-optional={String(!!hasOptionalQuestions)} />
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: { id: string }[] }) => (
    <div data-testid="open-questions-panel">{questions.length}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-123",
    linearIssueId: "li1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/x/issue/ENG-42",
    repo: "acme/widgets",
    branchName: "feature/fix",
    prNumber: 7,
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

const EVENTS: RunEventRecord[] = [];

function renderPage(id = "run-123") {
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
    mockUseRun.mockReset();
    mockUseRunSkills.mockReset();
    mockUseActiveProcesses.mockReset();
    mockUseRunSkills.mockReturnValue({ data: null, loading: false, error: null });
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("workflow-stepper")).toBeNull();
  });

  it("shows an error message when the run failed to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run not found on server",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run not found on server")).toBeDefined();
  });

  it("shows a fallback 'Run not found' message when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details and child panels once loaded", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: EVENTS },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("feature/fix")).toBeDefined();
    expect(screen.getByText("PR #7")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
  });

  it("falls back to the Linear identifier, then the raw issue id, when there is no title", () => {
    const run = makeRun({ linearIssueTitle: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: EVENTS },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("ENG-42")).toBeDefined();
  });

  it("does not render branch/PR links when the run has no branch", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: EVENTS },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByText(/PR #/)).toBeNull();
  });

  it("shows the required open-questions panel prominently in HumanClarificationNeeded", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Deploy target?", requiredForExecution: true },
          { id: "q2", question: "Perf concerns?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: EVENTS },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    // Both required + optional questions are shown here (all open questions)
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2");
    expect(screen.getByTestId("action-bar").dataset.hasOptional).toBe("true");
  });

  it("shows only optional questions in AwaitingPlanApproval, and no panel when there are none", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required one", requiredForExecution: true },
          { id: "q2", question: "Optional one", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: EVENTS },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1");
    expect(screen.getByTestId("action-bar").dataset.hasOptional).toBe("true");
  });

  it("renders no open-questions panel and hasOptionalQuestions=false when the plan has none", () => {
    const run = makeRun({ state: "Implementing" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: EVENTS },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("action-bar").dataset.hasOptional).toBe("false");
  });

  it("passes artifacts through to ArtifactTabs", () => {
    const run = makeRun();
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "ExecutionReport",
        version: 1,
        payloadJson: {},
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: EVENTS },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1");
  });

  it("shows the Linear link only when the run has a linearIssueUrl", () => {
    const run = makeRun({ linearIssueUrl: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: EVENTS },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });
});
