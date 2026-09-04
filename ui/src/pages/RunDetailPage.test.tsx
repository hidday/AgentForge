import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const mockUseRun = vi.fn();
vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (...args: unknown[]) => mockUseRun(...args),
}));

const mockUseRunSkills = vi.fn();
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (...args: unknown[]) => mockUseRunSkills(...args),
}));

const mockUseActiveProcesses = vi.fn();
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (...args: unknown[]) => mockUseActiveProcesses(...args),
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
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length}</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ hasOptionalQuestions }: { hasOptionalQuestions: boolean }) => (
    <div data-testid="action-bar">{String(hasOptionalQuestions)}</div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: unknown[] }) => (
    <div data-testid="open-questions-panel">{questions.length}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

import { RunDetailPage } from "./RunDetailPage";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1234567890",
    linearIssueId: "li-1",
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
    workingDirectory: "/work/dir",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const SKILLS_DEFAULT = {
  data: null,
  loading: false,
  error: null,
  refetch: vi.fn(),
};

const PROCESSES_DEFAULT = {
  processes: [],
  hasActive: false,
  output: "",
  activeProcessId: null,
};

function renderAt(id = "run-1234567890") {
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
    mockUseRunSkills.mockReturnValue(SKILLS_DEFAULT);
    mockUseActiveProcesses.mockReturnValue(PROCESSES_DEFAULT);
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderAt();
    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("shows an error message when the run failed to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run fetch failed",
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByText("Run fetch failed")).toBeDefined();
  });

  it("shows a fallback 'Run not found' message when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderAt();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details, state badge and panels once loaded", () => {
    const run = makeRun({});
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();

    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("fix/bug")).toBeDefined();
    expect(screen.getByText(/PR #42/)).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
  });

  it("falls back to the linear issue identifier, then id prefix, when no title is set", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-9" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByText("ENG-9")).toBeDefined();

    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueId: "abcdefgh12345" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("does not render the branch/PR/editor links when branchName is absent", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle(/Open PR on GitHub/)).toBeNull();
  });

  it("shows the open questions panel for HumanClarificationNeeded with required questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", text: "Which env?", requiredForExecution: true },
          { id: "q2", text: "Optional one", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();

    // All open questions (both required and optional) are shown here.
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2");
  });

  it("shows only optional questions in AwaitingPlanApproval state, in the action bar flag too", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const planArtifact: Artifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", text: "Required", requiredForExecution: true },
          { id: "q2", text: "Optional", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1");
    expect(screen.getByTestId("action-bar").textContent).toBe("true");
  });

  it("does not render the open questions panel when there is no Plan artifact", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("action-bar").textContent).toBe("false");
  });

  it("passes distilled skill data and loading/error state through to DistilledSkillPanel", () => {
    const run = makeRun({});
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRunSkills.mockReturnValue({
      data: { distilledSkill: { id: "s1" }, distillationDecision: null, injectedSkills: [] },
      loading: true,
      error: "skills error",
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
  });
});
