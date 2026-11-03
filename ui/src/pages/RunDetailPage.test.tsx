import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("react-router-dom", () => ({
  useParams: vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

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
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length} events</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ state }: { state: string }) => <div data-testid="action-bar">{state}</div>,
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

import { RunDetailPage } from "./RunDetailPage";
import { useParams } from "react-router-dom";
import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";

const mockUseParams = useParams as unknown as ReturnType<typeof vi.fn>;
const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;

const BASE_RUN: Run = {
  id: "run-123456789",
  linearIssueId: "issue-123456789",
  linearIssueIdentifier: "ENG-1",
  linearIssueDescription: null,
  linearIssueTitle: "Fix the bug",
  linearIssueUrl: "https://linear.app/issue/ENG-1",
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
  workingDirectory: "/work/dir",
  latestArtifactVersion: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function setupHooks({
  run = BASE_RUN,
  artifacts = [] as Artifact[],
  events = [] as RunEventRecord[],
  loading = false,
  error = null as string | null,
}: {
  run?: Run;
  artifacts?: Artifact[];
  events?: RunEventRecord[];
  loading?: boolean;
  error?: string | null;
} = {}) {
  mockUseParams.mockReturnValue({ id: run.id });
  mockUseRun.mockReturnValue({
    data: loading || error ? null : { run, artifacts, events },
    loading,
    error,
    refetch: vi.fn(),
  });
  mockUseRunSkills.mockReturnValue({
    data: { injectedSkills: [], distillationDecision: null, distilledSkill: null },
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
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading indicator while the run is loading", () => {
    setupHooks({ loading: true });
    render(<RunDetailPage />);
    expect(screen.getByText(/Loading run/i)).toBeDefined();
    expect(screen.queryByTestId("workflow-stepper")).toBeNull();
  });

  it("shows an error message when the run fetch fails", () => {
    setupHooks({ error: "boom" });
    render(<RunDetailPage />);
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows a 'Run not found' message when there is no error but also no data", () => {
    mockUseParams.mockReturnValue({ id: "run-1" });
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
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
    render(<RunDetailPage />);
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the main layout once the run has loaded", () => {
    setupHooks();
    render(<RunDetailPage />);

    expect(screen.getByTestId("workflow-stepper").textContent).toBe("Implementing");
    expect(screen.getByTestId("action-bar").textContent).toBe("Implementing");
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("prefers linearIssueTitle over the identifier when both are present", () => {
    setupHooks({ run: { ...BASE_RUN, linearIssueTitle: "Fix the bug" } });
    render(<RunDetailPage />);
    expect(screen.getByText("Fix the bug")).toBeDefined();
  });

  it("falls back to the issue identifier when there is no title", () => {
    setupHooks({ run: { ...BASE_RUN, linearIssueTitle: null } });
    render(<RunDetailPage />);
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated issue id when there is no title or identifier", () => {
    setupHooks({
      run: {
        ...BASE_RUN,
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefghijklmnop",
      },
    });
    render(<RunDetailPage />);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders a link to open the PR when prNumber is set", () => {
    setupHooks({ run: { ...BASE_RUN, prNumber: 7, repo: "org/repo" } });
    render(<RunDetailPage />);
    const prLink = screen.getByRole("link", { name: /PR #7/i });
    expect(prLink.getAttribute("href")).toBe("https://github.com/org/repo/pull/7");
  });

  it("does not render a PR link when prNumber is null", () => {
    setupHooks({ run: { ...BASE_RUN, prNumber: null } });
    render(<RunDetailPage />);
    expect(screen.queryByRole("link", { name: /PR #/i })).toBeNull();
  });

  it("shows the OpenQuestionsPanel prominently when state is HumanClarificationNeeded with open questions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: BASE_RUN.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", requiredForExecution: true, question: "Which env?" },
          { id: "q2", requiredForExecution: false, question: "Optional detail?" },
        ],
      },
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
    };
    setupHooks({
      run: { ...BASE_RUN, state: "HumanClarificationNeeded" },
      artifacts: [planArtifact],
    });
    render(<RunDetailPage />);

    const panels = screen.getAllByTestId("open-questions-panel");
    expect(panels).toHaveLength(1);
    expect(panels[0]!.textContent).toBe("2 questions");
  });

  it("shows only optional questions in a secondary panel when state is AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: BASE_RUN.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", requiredForExecution: true, question: "Required?" },
          { id: "q2", requiredForExecution: false, question: "Optional?" },
        ],
      },
      rawText: "",
      createdAt: "2026-01-01T00:00:00Z",
    };
    setupHooks({
      run: { ...BASE_RUN, state: "AwaitingPlanApproval" },
      artifacts: [planArtifact],
    });
    render(<RunDetailPage />);

    const panels = screen.getAllByTestId("open-questions-panel");
    expect(panels).toHaveLength(1);
    expect(panels[0]!.textContent).toBe("1 questions");
    // ActionBar should know there are optional questions to scroll to.
    expect(screen.getByTestId("action-bar")).toBeDefined();
  });

  it("renders no OpenQuestionsPanel for a state that isn't HumanClarificationNeeded or AwaitingPlanApproval", () => {
    setupHooks({ run: { ...BASE_RUN, state: "Implementing" } });
    render(<RunDetailPage />);
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("renders no OpenQuestionsPanel when there is no Plan artifact at all", () => {
    setupHooks({ run: { ...BASE_RUN, state: "HumanClarificationNeeded" }, artifacts: [] });
    render(<RunDetailPage />);
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("passes artifact and event counts through to ArtifactTabs and EventTimeline", () => {
    const artifacts: Artifact[] = [
      { id: "a1", runId: BASE_RUN.id, type: "Plan", version: 1, payloadJson: {}, rawText: "", createdAt: "x" },
    ];
    const events: RunEventRecord[] = [
      { id: "e1", runId: BASE_RUN.id, eventType: "run:created", source: "system", payloadJson: {}, createdAt: "x" },
      { id: "e2", runId: BASE_RUN.id, eventType: "run:state-changed", source: "system", payloadJson: {}, createdAt: "x" },
    ];
    setupHooks({ artifacts, events });
    render(<RunDetailPage />);

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1 artifacts");
    expect(screen.getByTestId("event-timeline").textContent).toBe("2 events");
  });
});
