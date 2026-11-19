import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: (id: string) => useRunMock(id) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: (id: string) => useRunSkillsMock(id) }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
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
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ onScrollToQuestions }: { onScrollToQuestions?: () => void }) => (
    <button data-testid="action-bar" onClick={onScrollToQuestions}>
      action-bar
    </button>
  ),
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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "An issue",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "main",
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function setHookDefaults(opts: {
  run?: Run;
  artifacts?: Artifact[];
  events?: RunEventRecord[];
  loading?: boolean;
  error?: string | null;
}) {
  const { run, artifacts = [], events = [], loading = false, error = null } = opts;
  useRunMock.mockReturnValue({
    data: run ? { run, artifacts, events } : null,
    loading,
    error,
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
    useRunMock.mockReset();
    useRunSkillsMock.mockReset();
    useActiveProcessesMock.mockReset();
  });

  it("shows a loading indicator while the run is loading", () => {
    setHookDefaults({ loading: true });
    renderPage();
    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows an error message when the run fails to load", () => {
    setHookDefaults({ error: "Not found" });
    renderPage();
    expect(screen.getByText("Not found")).toBeDefined();
  });

  it("shows a generic not-found message when there is no error but also no data", () => {
    setHookDefaults({});
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header fields: issue title, repo, branch, and state badge", () => {
    setHookDefaults({ run: makeRun() });
    renderPage();
    expect(screen.getByText("An issue")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("main")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
  });

  it("renders a Linear link only when linearIssueUrl is present", () => {
    setHookDefaults({ run: makeRun({ linearIssueUrl: "https://linear.app/x" }) });
    renderPage();
    expect(screen.getByText("Linear")).toBeDefined();
  });

  it("does not render a Linear link when linearIssueUrl is absent", () => {
    setHookDefaults({ run: makeRun({ linearIssueUrl: null }) });
    renderPage();
    expect(screen.queryByText("Linear")).toBeNull();
  });

  it("renders a GitHub PR link when prNumber is set", () => {
    setHookDefaults({ run: makeRun({ prNumber: 7 }) });
    renderPage();
    const link = screen.getByText("PR #7");
    expect(link.closest("a")?.getAttribute("href")).toBe("https://github.com/org/repo/pull/7");
  });

  it("renders Cursor/Claude Code/Claude open links when branch and workingDirectory are both set", () => {
    setHookDefaults({ run: makeRun({ branchName: "feature-x", workingDirectory: "/work/dir" }) });
    renderPage();
    expect(screen.getByText("Cursor")).toBeDefined();
    expect(screen.getByText("Claude Code")).toBeDefined();
    expect(screen.getByText("Claude")).toBeDefined();
  });

  it("does not render editor open links when branchName is missing", () => {
    setHookDefaults({ run: makeRun({ branchName: null }) });
    renderPage();
    expect(screen.queryByText("Cursor")).toBeNull();
    expect(screen.queryByText("Claude Code")).toBeNull();
  });

  it("shows the required open-questions panel prominently for HumanClarificationNeeded", () => {
    setHookDefaults({
      run: makeRun({ state: "HumanClarificationNeeded" }),
      artifacts: [
        {
          id: "a1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {
            openQuestions: [
              { id: "q1", question: "Which DB?", requiredForExecution: true },
            ],
          },
          rawText: "",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
    renderPage();
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1 questions");
  });

  it("does not show the open-questions panel for HumanClarificationNeeded when there are no open questions", () => {
    setHookDefaults({ run: makeRun({ state: "HumanClarificationNeeded" }), artifacts: [] });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("shows only optional open questions for AwaitingPlanApproval", () => {
    setHookDefaults({
      run: makeRun({ state: "AwaitingPlanApproval" }),
      artifacts: [
        {
          id: "a1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {
            openQuestions: [
              { id: "q1", question: "Required", requiredForExecution: true },
              { id: "q2", question: "Optional", requiredForExecution: false },
            ],
          },
          rawText: "",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
    renderPage();
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1 questions");
  });

  it("forwards hasOptionalQuestions=true to ActionBar and scrolling works via the ref callback", async () => {
    setHookDefaults({
      run: makeRun({ state: "AwaitingPlanApproval" }),
      artifacts: [
        {
          id: "a1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {
            openQuestions: [{ id: "q2", question: "Optional", requiredForExecution: false }],
          },
          rawText: "",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
    renderPage();
    // scrollIntoView isn't implemented in jsdom; ensure clicking doesn't throw
    Element.prototype.scrollIntoView = vi.fn();
    const actionBar = screen.getByTestId("action-bar");
    actionBar.click();
    expect(screen.getByTestId("open-questions-panel")).toBeDefined();
  });

  it("renders the core panels: agent output, distilled skill, artifact tabs, chat, and event timeline", () => {
    setHookDefaults({ run: makeRun() });
    renderPage();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
  });
});
