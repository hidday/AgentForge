import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const useParamsMock = vi.fn();
const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useParams: () => useParamsMock(),
  };
});

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
  ArtifactTabs: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{artifacts.length} artifacts</div>
  ),
}));

vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));

vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));

vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: () => <div data-testid="action-bar" />,
}));

vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: unknown[] }) => (
    <div data-testid="open-questions-panel">{questions.length} questions</div>
  ),
}));

vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-abc12345"]}>
      <RunDetailPage />
    </MemoryRouter>,
  );
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-abc12345",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  } as Run;
}

function defaultActiveProcesses() {
  return { processes: [], hasActive: false, output: "", activeProcessId: null };
}

function defaultSkills() {
  return { data: null, loading: false, error: null, refetch: vi.fn() };
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    useParamsMock.mockReset();
    useRunMock.mockReset();
    useRunSkillsMock.mockReset();
    useActiveProcessesMock.mockReset();

    useParamsMock.mockReturnValue({ id: "run-abc12345" });
    useActiveProcessesMock.mockReturnValue(defaultActiveProcesses());
    useRunSkillsMock.mockReturnValue(defaultSkills());
  });

  it("reads the run id from the URL params and passes it to useRun", () => {
    useParamsMock.mockReturnValue({ id: "my-run-id" });
    useRunMock.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(useRunMock).toHaveBeenCalledWith("my-run-id");
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/Loading run/i)).toBeDefined();
    expect(screen.queryByTestId("state-badge")).toBeNull();
  });

  it("shows an error message when the run fails to load", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "Network error",
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("shows a 'Run not found' fallback message when there is no error but also no data", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run details on successful load", () => {
    const run = makeRun({ state: "Implementing" });
    const artifacts: Artifact[] = [];
    const events: RunEventRecord[] = [];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Run Detail")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("0 artifacts");
    // Issue id/title shown
    expect(screen.getByText("Fix the bug")).toBeDefined();
    // Repo shown
    expect(screen.getByText("org/repo")).toBeDefined();
  });

  it("shows the open questions panel when state is HumanClarificationNeeded and questions exist", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "What auth?", requiredForExecution: true },
            { id: "q2", question: "Optional detail?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // All open questions (both required and optional) shown for
    // HumanClarificationNeeded state.
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2 questions");
  });

  it("shows only optional open questions panel when state is AwaitingPlanApproval", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts: Artifact[] = [
      {
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
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // Only the optional question should be passed through in this state.
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1 questions");
  });

  it("does not render the open questions panel when there are no open questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("renders a PR link when the run has a prNumber", () => {
    const run = makeRun({ prNumber: 42, repo: "org/repo" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const prLink = screen.getByTitle("Open PR on GitHub") as HTMLAnchorElement;
    expect(prLink.href).toBe("https://github.com/org/repo/pull/42");
    expect(prLink.textContent).toContain("42");
  });

  it("does not render a PR link when the run has no prNumber", () => {
    const run = makeRun({ prNumber: null });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
  });

  it("renders a branch name and Cursor/Claude Code links when branchName and workingDirectory are set", () => {
    const run = makeRun({
      branchName: "feature/my-branch",
      workingDirectory: "/home/user/work",
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("feature/my-branch")).toBeDefined();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
  });
});
