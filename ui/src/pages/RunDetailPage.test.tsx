import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const mockUseRun = vi.fn();
const mockUseRunSkills = vi.fn();
const mockUseActiveProcesses = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: (id: string) => mockUseRun(id) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: (id: string) => mockUseRunSkills(id) }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => mockUseActiveProcesses(id),
}));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <div data-testid="state-badge">{state}</div>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: () => <div data-testid="workflow-stepper" />,
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: () => <div data-testid="artifact-tabs" />,
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));

let capturedScrollToQuestions: (() => void) | null = null;
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ onScrollToQuestions }: { onScrollToQuestions: () => void }) => {
    capturedScrollToQuestions = onScrollToQuestions;
    return <div data-testid="action-bar" />;
  },
}));

vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: Array<{ question: string }> }) => (
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

function baseRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-id-12345678",
    linearIssueId: "issue-id-12345678",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/1",
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
    workingDirectory: "/work/dir",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderAt(id = "run-id-12345678") {
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
    capturedScrollToQuestions = null;
    mockUseRunSkills.mockReturnValue({ data: null, loading: false, error: null });
    mockUseActiveProcesses.mockReturnValue({ processes: [], output: "" });
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderAt();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows the error message when the run failed to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "boom",
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows 'Run not found' when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderAt();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details and the state badge once loaded", () => {
    const run = baseRun({ branchName: "feature/x", prNumber: 42 });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [] as Artifact[], events: [] as RunEventRecord[] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();

    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("feature/x")).toBeDefined();
    expect(screen.getByText("PR #42")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
  });

  it("does not render branch/PR/editor links when the run has no branch", () => {
    const run = baseRun({ branchName: null, prNumber: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();

    expect(screen.queryByText(/^PR #/)).toBeNull();
    expect(screen.queryByText("Cursor")).toBeNull();
    expect(screen.queryByText("Claude Code")).toBeNull();
  });

  it("shows the required open-questions panel when state is HumanClarificationNeeded", () => {
    const run = baseRun({ state: "HumanClarificationNeeded" });
    const planArtifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
      payloadJson: {
        openQuestions: [
          { question: "Required?", requiredForExecution: true },
          { question: "Optional?", requiredForExecution: false },
        ],
      },
    } as unknown as Artifact;
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();

    // All open questions (required + optional) are shown for HumanClarificationNeeded.
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2");
  });

  it("shows only optional open-questions when state is AwaitingPlanApproval", () => {
    const run = baseRun({ state: "AwaitingPlanApproval" });
    const planArtifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
      payloadJson: {
        openQuestions: [
          { question: "Required?", requiredForExecution: true },
          { question: "Optional?", requiredForExecution: false },
        ],
      },
    } as unknown as Artifact;
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1");
  });

  it("renders no open-questions panel when there is no Plan artifact", () => {
    const run = baseRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("wires the ActionBar's scroll-to-questions callback to scroll the questions ref into view", () => {
    const run = baseRun({ state: "HumanClarificationNeeded" });
    const planArtifact = {
      id: "a1",
      runId: run.id,
      type: "Plan",
      version: 1,
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
      payloadJson: { openQuestions: [{ question: "Q", requiredForExecution: true }] },
    } as unknown as Artifact;
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;

    renderAt();
    expect(capturedScrollToQuestions).not.toBeNull();
    capturedScrollToQuestions!();

    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});
