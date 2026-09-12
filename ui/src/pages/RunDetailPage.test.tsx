import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";

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
    onScrollToQuestions,
    hasOptionalQuestions,
  }: {
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  }) => (
    <div data-testid="action-bar">
      <span data-testid="has-optional">{String(hasOptionalQuestions)}</span>
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({
    questions,
    readOnly,
  }: {
    questions: OpenQuestion[];
    readOnly?: boolean;
  }) => (
    <div data-testid="open-questions">
      <span data-testid="question-count">{questions.length}</span>
      <span data-testid="read-only">{String(readOnly)}</span>
    </div>
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
    id: "abcdefgh-1234",
    linearIssueId: "issue-uuid-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
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
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function setHookDefaults() {
  mockUseActiveProcesses.mockReturnValue({ processes: [], output: "" });
  mockUseRunSkills.mockReturnValue({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/abcdefgh-1234"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHookDefaults();
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("shows the error message when the run fails to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run fetch failed",
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Run fetch failed")).toBeDefined();
  });

  it("shows a fallback message when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders full run details when populated, with all optional links", () => {
    const run = makeRun({
      branchName: "feat/my-branch",
      prNumber: 7,
      linearIssueUrl: "https://linear.app/issue/ENG-42",
      workingDirectory: "/work/dir",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // ID is sliced to 8 chars.
    expect(screen.getByText(run.id.slice(0, 8))).toBeDefined();
    // Issue title takes precedence over identifier/id.
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByRole("link", { name: /linear/i })).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("feat/my-branch")).toBeDefined();
    expect(screen.getByRole("link", { name: /pr #7/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /cursor/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /claude code/i })).toBeDefined();
    // "Claude" (Desktop) link vs "Claude Code" link both present; check count.
    expect(screen.getAllByText(/claude/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("workflow-stepper").textContent).toBe(
      "Implementing",
    );
  });

  it("falls back to identifier and then id when the issue has no title, and omits optional links when absent", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: "ENG-99",
      branchName: null,
      prNumber: null,
      linearIssueUrl: null,
      workingDirectory: "",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("ENG-99")).toBeDefined();
    expect(screen.queryByRole("link", { name: /linear/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /pr #/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /cursor/i })).toBeNull();
  });

  it("falls back to a sliced linearIssueId when title and identifier are both absent", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "zzzzzzzz-issue-id",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("zzzzzzzz")).toBeDefined();
  });

  it("shows the required open-questions panel prominently in HumanClarificationNeeded", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const questions: OpenQuestion[] = [
      { id: "q1", question: "What now?", requiredForExecution: true },
      { id: "q2", question: "And this?", requiredForExecution: false },
    ];
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: { openQuestions: questions },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("open-questions")).toBeDefined();
    // Both questions (required + optional) shown here, not filtered.
    expect(screen.getByTestId("question-count").textContent).toBe("2");
    expect(screen.getByTestId("read-only").textContent).toBe("false");
  });

  it("shows only optional questions in AwaitingPlanApproval, and reflects hasOptionalQuestions on the ActionBar", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required one", requiredForExecution: true },
      { id: "q2", question: "Optional one", requiredForExecution: false },
    ];
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: { openQuestions: questions },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("question-count").textContent).toBe("1");
    expect(screen.getByTestId("has-optional").textContent).toBe("true");
  });

  it("does not render an open-questions panel when there is no matching Plan artifact", () => {
    const run = makeRun({ state: "Implementing" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByTestId("open-questions")).toBeNull();
    expect(screen.getByTestId("has-optional").textContent).toBe("false");
  });

  it("scrolls to the questions panel when the ActionBar requests it", async () => {
    const user = userEvent.setup();
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const questions: OpenQuestion[] = [
      { id: "q1", question: "What now?", requiredForExecution: true },
    ];
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: { openQuestions: questions },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const scrollSpy = vi.fn();
    // jsdom does not implement scrollIntoView.
    Element.prototype.scrollIntoView = scrollSpy;

    renderPage();
    await user.click(screen.getByRole("button", { name: "scroll-to-questions" }));

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("passes events and artifacts through to child panels", () => {
    const run = makeRun();
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {},
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: run.id,
        eventType: "run:state-changed",
        source: "system",
        payloadJson: {},
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
  });
});
