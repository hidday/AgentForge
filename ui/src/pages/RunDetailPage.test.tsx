import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));

vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: () => <div data-testid="artifact-tabs" />,
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    runId,
    state,
    onAction,
    onScrollToQuestions,
    hasOptionalQuestions,
  }: {
    runId: string;
    state: string;
    onAction: () => void;
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  }) => (
    <div data-testid="action-bar">
      <span data-testid="action-bar-run-id">{runId}</span>
      <span data-testid="action-bar-state">{state}</span>
      <span data-testid="action-bar-has-optional">{String(hasOptionalQuestions)}</span>
      <button onClick={onAction}>action-bar-trigger-action</button>
      <button onClick={onScrollToQuestions}>action-bar-scroll</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({
    questions,
    runState,
    onSubmitted,
  }: {
    questions: Array<{ id: string }>;
    runState?: string;
    onSubmitted?: () => void;
  }) => (
    <div data-testid="open-questions-panel">
      <span data-testid="open-questions-count">{questions.length}</span>
      <span data-testid="open-questions-run-state">{runState}</span>
      <button onClick={onSubmitted}>submit-questions</button>
    </div>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";
import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T01:00:00Z",
    ...overrides,
  };
}

function setHookDefaults(opts: {
  run: Run;
  artifacts?: Artifact[];
  events?: RunEventRecord[];
  loading?: boolean;
  error?: string | null;
  refetch?: ReturnType<typeof vi.fn>;
}) {
  const refetch = opts.refetch ?? vi.fn();
  mockUseRun.mockReturnValue({
    data:
      opts.loading || opts.error
        ? null
        : { run: opts.run, artifacts: opts.artifacts ?? [], events: opts.events ?? [] },
    loading: opts.loading ?? false,
    error: opts.error ?? null,
    refetch,
  });
  mockUseRunSkills.mockReturnValue({
    data: { distilledSkill: null, distillationDecision: null, injectedSkills: [] },
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseActiveProcesses.mockReturnValue({ processes: [], output: "", hasActive: false, activeProcessId: null });
  return refetch;
}

function renderPage(id = "run-1") {
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
  });

  it("shows a loading indicator while the run is loading", () => {
    setHookDefaults({ run: makeRun(), loading: true });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows an error message when the run fails to load", () => {
    setHookDefaults({ run: makeRun(), error: "Failed to fetch run" });
    renderPage();
    expect(screen.getByText("Failed to fetch run")).toBeDefined();
  });

  it("shows 'Run not found' when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    mockUseRunSkills.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    mockUseActiveProcesses.mockReturnValue({ processes: [], output: "", hasActive: false, activeProcessId: null });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run id, issue title and repo in the header", () => {
    setHookDefaults({ run: makeRun({ id: "abcdefgh-1234" }) });
    renderPage("abcdefgh-1234");
    expect(screen.getByText("abcdefgh")).toBeDefined();
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
  });

  it("falls back to the issue identifier when no title is set", () => {
    setHookDefaults({ run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-7" }) });
    renderPage();
    expect(screen.getByText("ENG-7")).toBeDefined();
  });

  it("falls back to a truncated issue id when neither title nor identifier is set", () => {
    setHookDefaults({
      run: makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    });
    renderPage();
    expect(screen.getAllByText("abcdefgh").length).toBeGreaterThan(0);
  });

  it("renders the external Linear header link only when linearIssueUrl is present", () => {
    setHookDefaults({ run: makeRun({ linearIssueUrl: "https://linear.app/issue/ENG-1" }) });
    renderPage();
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/ENG-1");
  });

  it("does not render the Linear header link when linearIssueUrl is absent", () => {
    setHookDefaults({ run: makeRun({ linearIssueUrl: null }) });
    renderPage();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("renders the branch name only when present", () => {
    setHookDefaults({ run: makeRun({ branchName: "feature/x" }) });
    renderPage();
    expect(screen.getByText("feature/x")).toBeDefined();
  });

  it("renders the PR link only when prNumber is set", () => {
    setHookDefaults({ run: makeRun({ prNumber: 99, repo: "acme/widgets" }) });
    renderPage();
    const link = screen.getByTitle("Open PR on GitHub");
    expect(link.getAttribute("href")).toBe("https://github.com/acme/widgets/pull/99");
  });

  it("renders Cursor/Claude Code/Claude links only when both branchName and workingDirectory are set", () => {
    setHookDefaults({
      run: makeRun({ branchName: "feature/x", workingDirectory: "/tmp/wd" }),
    });
    renderPage();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });

  it("renders the StateBadge with the run's current state", () => {
    setHookDefaults({ run: makeRun({ state: "AIBlocked" }) });
    renderPage();
    expect(screen.getByText("A I Blocked")).toBeDefined();
  });

  it("shows the OpenQuestionsPanel with all open questions in HumanClarificationNeeded", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    setHookDefaults({
      run: makeRun({ state: "HumanClarificationNeeded" }),
      artifacts: [planArtifact],
    });
    renderPage();

    expect(screen.getByTestId("open-questions-count").textContent).toBe("2");
    expect(screen.getByTestId("open-questions-run-state").textContent).toBe(
      "HumanClarificationNeeded",
    );
  });

  it("shows only optional open questions in AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    setHookDefaults({
      run: makeRun({ state: "AwaitingPlanApproval" }),
      artifacts: [planArtifact],
    });
    renderPage();

    expect(screen.getByTestId("open-questions-count").textContent).toBe("1");
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("true");
  });

  it("does not show the OpenQuestionsPanel for a state with no relevant open questions", () => {
    setHookDefaults({ run: makeRun({ state: "Implementing" }) });
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("false");
  });

  it("calls refetch when the OpenQuestionsPanel reports a submission", async () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    const refetch = vi.fn();
    setHookDefaults({
      run: makeRun({ state: "HumanClarificationNeeded" }),
      artifacts: [planArtifact],
      refetch,
    });
    renderPage();

    await userEvent.click(screen.getByText("submit-questions"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("passes the run id, state and refetch through to the ActionBar", async () => {
    const refetch = vi.fn();
    setHookDefaults({ run: makeRun({ id: "run-42", state: "ReadyForHumanReview" }), refetch });
    renderPage("run-42");

    expect(screen.getByTestId("action-bar-run-id").textContent).toBe("run-42");
    expect(screen.getByTestId("action-bar-state").textContent).toBe("ReadyForHumanReview");

    await userEvent.click(screen.getByText("action-bar-trigger-action"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("scrolls the questions panel into view when the ActionBar requests it", async () => {
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    setHookDefaults({
      run: makeRun({ state: "AwaitingPlanApproval" }),
      artifacts: [planArtifact],
    });
    renderPage();

    await userEvent.click(screen.getByText("action-bar-scroll"));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("renders the child panels for artifacts, agent output, skills, events and chat", () => {
    setHookDefaults({ run: makeRun() });
    renderPage();

    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
  });
});
