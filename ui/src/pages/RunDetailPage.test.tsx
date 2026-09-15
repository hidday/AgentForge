import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (id: string) => useRunMock(id),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => useRunSkillsMock(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
}));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => (
    <div data-testid="state-badge">{state}</div>
  ),
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
      <button onClick={onScrollToQuestions}>Scroll To Questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: OpenQuestion[] }) => (
    <div data-testid="open-questions-panel">
      {questions.map((q) => (
        <span key={q.id}>{q.id}</span>
      ))}
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
    id: "run-1-full-uuid",
    linearIssueId: "issue-full-uuid",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePlanArtifact(questions: OpenQuestion[]): Artifact {
  return {
    id: "artifact-plan-1",
    runId: "run-1-full-uuid",
    type: "Plan",
    version: 1,
    payloadJson: { openQuestions: questions },
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

const EVENTS: RunEventRecord[] = [];

function setDefaultHookMocks(overrides?: {
  run?: Partial<Run>;
  artifacts?: Artifact[];
  loading?: boolean;
  error?: string | null;
  data?: null;
}) {
  const run = makeRun(overrides?.run);
  const artifacts = overrides?.artifacts ?? [];
  useRunMock.mockReturnValue({
    data:
      overrides?.data === null
        ? null
        : { run, artifacts, events: EVENTS },
    loading: overrides?.loading ?? false,
    error: overrides?.error ?? null,
    refetch: vi.fn(),
  });
  useRunSkillsMock.mockReturnValue({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  useActiveProcessesMock.mockReturnValue({
    processes: [],
    hasActive: false,
    output: "",
    activeProcessId: null,
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-1"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultHookMocks();
  });

  it("shows a loading spinner when useRun reports loading", () => {
    setDefaultHookMocks({ loading: true });
    renderPage();
    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("shows an error banner when useRun reports an error", () => {
    setDefaultHookMocks({ error: "boom" });
    renderPage();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows a 'Run not found' banner when data is null and there is no error", () => {
    setDefaultHookMocks({ data: null });
    renderPage();
    expect(screen.getByText(/run not found/i)).toBeDefined();
  });

  it("renders header fields: id, repo, and issue fallback chain", () => {
    setDefaultHookMocks({
      run: {
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "issue-full-uuid",
      },
    });
    renderPage();
    // id is sliced to 8 chars
    expect(screen.getByText("run-1-fu")).toBeDefined();
    // repo rendered verbatim
    expect(screen.getByText("org/repo")).toBeDefined();
    // Fallback chain: no title, no identifier -> sliced issue id
    expect(screen.getByText("issue-fu")).toBeDefined();
  });

  it("prefers linearIssueTitle over identifier and id in the fallback chain", () => {
    setDefaultHookMocks({
      run: {
        linearIssueTitle: "My Great Issue",
        linearIssueIdentifier: "ENG-123",
      },
    });
    renderPage();
    expect(screen.getByText("My Great Issue")).toBeDefined();
    expect(screen.queryByText("ENG-123")).toBeNull();
  });

  it("prefers linearIssueIdentifier over the sliced id when there is no title", () => {
    setDefaultHookMocks({
      run: {
        linearIssueTitle: null,
        linearIssueIdentifier: "ENG-123",
      },
    });
    renderPage();
    expect(screen.getByText("ENG-123")).toBeDefined();
  });

  it("renders a link to Linear when linearIssueUrl is set", () => {
    setDefaultHookMocks({
      run: { linearIssueUrl: "https://linear.app/team/issue/ENG-123" },
    });
    renderPage();
    const link = screen.getByTitle("Open in Linear") as HTMLAnchorElement;
    expect(link.href).toBe("https://linear.app/team/issue/ENG-123");
  });

  it("does not render a Linear link when linearIssueUrl is absent", () => {
    setDefaultHookMocks({ run: { linearIssueUrl: null } });
    renderPage();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("does not render branch/PR/Cursor/Claude links when branchName and workingDirectory are absent", () => {
    setDefaultHookMocks({ run: { branchName: null, prNumber: null } });
    renderPage();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle("Open Claude Code session in this run's worktree")).toBeNull();
    expect(screen.queryByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
  });

  it("renders branch name but not Cursor/Claude deep links when workingDirectory is empty", () => {
    setDefaultHookMocks({
      run: { branchName: "feature/foo", workingDirectory: "" },
    });
    renderPage();
    expect(screen.getByText("feature/foo")).toBeDefined();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("renders PR link, and Cursor/Claude deep links only when both branchName and workingDirectory are set", () => {
    setDefaultHookMocks({
      run: {
        branchName: "feature/foo",
        workingDirectory: "/home/user/work",
        prNumber: 42,
        repo: "org/repo",
      },
    });
    renderPage();

    const prLink = screen.getByTitle("Open PR on GitHub") as HTMLAnchorElement;
    expect(prLink.href).toBe("https://github.com/org/repo/pull/42");

    const cursorLink = screen.getByTitle("Open in Cursor") as HTMLAnchorElement;
    expect(cursorLink.getAttribute("href")).toBe("cursor://file/home/user/work");

    const claudeCliLink = screen.getByTitle(
      "Open Claude Code session in this run's worktree",
    ) as HTMLAnchorElement;
    expect(claudeCliLink.getAttribute("href")).toBe(
      `claude-cli://open?cwd=${encodeURIComponent("/home/user/work")}`,
    );

    const claudeDesktopLink = screen.getByTitle(
      "Open Claude Desktop (Code) in this run's worktree",
    ) as HTMLAnchorElement;
    expect(claudeDesktopLink.getAttribute("href")).toBe(
      `claude://code/new?folder=${encodeURIComponent("/home/user/work")}`,
    );
  });

  it("renders OpenQuestionsPanel prominently with all open questions when state is HumanClarificationNeeded", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required one?", requiredForExecution: true },
      { id: "q2", question: "Optional one?", requiredForExecution: false },
    ];
    setDefaultHookMocks({
      run: { state: "HumanClarificationNeeded" },
      artifacts: [makePlanArtifact(questions)],
    });
    renderPage();

    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.textContent).toBe("q1q2");
  });

  it("renders OpenQuestionsPanel as a secondary panel with only optional questions when state is AwaitingPlanApproval", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required one?", requiredForExecution: true },
      { id: "q2", question: "Optional one?", requiredForExecution: false },
    ];
    setDefaultHookMocks({
      run: { state: "AwaitingPlanApproval" },
      artifacts: [makePlanArtifact(questions)],
    });
    renderPage();

    const panel = screen.getByTestId("open-questions-panel");
    // Only the non-required question is passed through in this state
    expect(panel.textContent).toBe("q2");
  });

  it("does not render OpenQuestionsPanel in other states", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required one?", requiredForExecution: true },
    ];
    setDefaultHookMocks({
      run: { state: "Implementing" },
      artifacts: [makePlanArtifact(questions)],
    });
    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("passes hasOptionalQuestions=true to ActionBar when there are optional questions in AwaitingPlanApproval", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Optional one?", requiredForExecution: false },
    ];
    setDefaultHookMocks({
      run: { state: "AwaitingPlanApproval" },
      artifacts: [makePlanArtifact(questions)],
    });
    renderPage();

    expect(screen.getByTestId("action-bar").dataset.hasOptional).toBe("true");
  });

  it("passes hasOptionalQuestions=false to ActionBar when there are no optional questions", () => {
    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required one?", requiredForExecution: true },
    ];
    setDefaultHookMocks({
      run: { state: "AwaitingPlanApproval" },
      artifacts: [makePlanArtifact(questions)],
    });
    renderPage();

    expect(screen.getByTestId("action-bar").dataset.hasOptional).toBe("false");
  });

  it("calls scrollIntoView on the questions ref element when the scroll action is triggered", () => {
    const scrollIntoViewSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;

    const questions: OpenQuestion[] = [
      { id: "q1", question: "Required one?", requiredForExecution: true },
    ];
    setDefaultHookMocks({
      run: { state: "HumanClarificationNeeded" },
      artifacts: [makePlanArtifact(questions)],
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /scroll to questions/i }));

    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});
