import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const mockUseRun = vi.fn();
const mockUseRunSkills = vi.fn();
const mockUseActiveProcesses = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: (...args: unknown[]) => mockUseRun(...args) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (...args: unknown[]) => mockUseRunSkills(...args),
}));
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
  ArtifactTabs: () => <div data-testid="artifact-tabs" />,
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    onScrollToQuestions,
    hasOptionalQuestions,
  }: {
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  }) => (
    <div data-testid="action-bar" data-has-optional={String(hasOptionalQuestions)}>
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: Array<{ id: string }> }) => (
    <div data-testid="open-questions-panel">{questions.map((q) => q.id).join(",")}</div>
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
    id: "run-abcdefgh-1234",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
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
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const artifacts: Artifact[] = [];
const events: RunEventRecord[] = [];

function renderPage(runId = "run-1") {
  return render(
    <MemoryRouter initialEntries={[`/runs/${runId}`]}>
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
    mockUseActiveProcesses.mockReturnValue({ processes: [], output: "" });
  });

  it("shows a loading state while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows an error message when the hook reports an error", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run not found",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("shows a fallback 'Run not found' message when there's no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details: id, issue link, repo, branch, PR link, and state", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({ data: { run, artifacts, events }, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText("run-abcd")).toBeDefined();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("feature/fix")).toBeDefined();
    expect(screen.getByText("PR #42")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });

  it("falls back to the issue identifier when the issue title is missing", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueUrl: null });
    mockUseRun.mockReturnValue({ data: { run, artifacts, events }, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("ENG-1")).toBeDefined();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("falls back to a truncated linearIssueId when both title and identifier are missing", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "abcdefgh-1234",
      linearIssueUrl: null,
    });
    mockUseRun.mockReturnValue({ data: { run, artifacts, events }, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("omits branch/PR/editor links when branchName is absent", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    mockUseRun.mockReturnValue({ data: { run, artifacts, events }, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByText(/^PR #/)).toBeNull();
  });

  it("shows the HumanClarificationNeeded questions panel prominently with all open questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact: Artifact = {
      id: "plan-1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("q1,q2");
  });

  it("shows only optional questions in the secondary panel for AwaitingPlanApproval", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const planArtifact: Artifact = {
      id: "plan-1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("q2");
    expect(screen.getByTestId("action-bar").getAttribute("data-has-optional")).toBe("true");
  });

  it("does not render an open questions panel when there are no open questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("scrolls the questions section into view when the action bar requests it", async () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact: Artifact = {
      id: "plan-1",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      },
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    renderPage();
    await userEvent.click(screen.getByText("scroll-to-questions"));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("renders the always-present chat panel, artifact tabs, and distilled skill panel", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({ data: { run, artifacts, events }, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
  });
});
