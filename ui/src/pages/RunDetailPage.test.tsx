import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

// --- Mock the three data hooks this page calls directly ---
vi.mock("@/hooks/useRun.ts", () => ({
  useRun: vi.fn(),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: vi.fn(),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: vi.fn(),
}));

// --- Mock heavier/independently-tested children with minimal stand-ins ---
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: (props: { runId: string; artifacts: Artifact[] }) => (
    <div data-testid="chat-panel">
      chat for {props.runId} ({props.artifacts.length} artifacts)
    </div>
  ),
}));

vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: (props: {
    distilledSkill: unknown;
    distillationDecision: unknown;
    loading?: boolean;
    error?: string | null;
  }) => (
    <div data-testid="distilled-skill-panel">
      loading={String(!!props.loading)} error={String(props.error ?? "")}
    </div>
  ),
}));

let capturedActionBarProps: {
  runId: string;
  state: string;
  onAction: () => void;
  onScrollToQuestions?: () => void;
  hasOptionalQuestions?: boolean;
} | null = null;

vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: {
    runId: string;
    state: string;
    onAction: () => void;
    onScrollToQuestions?: () => void;
    hasOptionalQuestions?: boolean;
  }) => {
    capturedActionBarProps = props;
    return (
      <div data-testid="action-bar">
        <span data-testid="action-bar-state">{props.state}</span>
        <span data-testid="action-bar-has-optional">
          {String(!!props.hasOptionalQuestions)}
        </span>
        <button data-testid="action-bar-scroll" onClick={props.onScrollToQuestions}>
          scroll
        </button>
      </div>
    );
  },
}));

import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { RunDetailPage } from "./RunDetailPage.tsx";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;

const RUN_ID = "run-abc12345";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    linearIssueId: "issue-xyz987",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the flaky test",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work/acme-widgets",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const requiredQuestion = {
  id: "q1",
  question: "Which deployment target should this use?",
  requiredForExecution: true,
};
const optionalQuestion = {
  id: "q2",
  question: "Any perf considerations we should flag?",
  requiredForExecution: false,
};

function makePlanArtifact(openQuestions: typeof requiredQuestion[]): Artifact {
  return {
    id: "art-plan-1",
    runId: RUN_ID,
    type: "Plan",
    version: 1,
    payloadJson: { openQuestions },
    rawText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function defaultActiveProcesses() {
  return { processes: [], hasActive: false, output: "", activeProcessId: null };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/runs/${RUN_ID}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedActionBarProps = null;
    HTMLElement.prototype.scrollIntoView = vi.fn();

    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue(defaultActiveProcesses());
  });

  it("shows a loading spinner while useRun is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("shows an error box when useRun errors", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Failed to fetch run",
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Failed to fetch run")).toBeDefined();
  });

  it("shows a 'Run not found' error box when useRun has no error but no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run id, repo, and issue identifier fallback when no title/url", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueUrl: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText(run.id.slice(0, 8))).toBeDefined();
    expect(screen.getByText(run.repo)).toBeDefined();
    expect(screen.getByText(run.linearIssueIdentifier!)).toBeDefined();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("falls back to the linearIssueId prefix when neither title nor identifier is set", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText(run.linearIssueId.slice(0, 8))).toBeDefined();
  });

  it("renders the Linear link, PR link, and branch name when present", () => {
    const run = makeRun({
      linearIssueUrl: "https://linear.app/acme/issue/ENG-42",
      branchName: "feature/flaky-fix",
      prNumber: 7,
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const linearLink = screen.getByTitle("Open in Linear") as HTMLAnchorElement;
    expect(linearLink.href).toBe(run.linearIssueUrl);

    const prLink = screen.getByTitle("Open PR on GitHub") as HTMLAnchorElement;
    expect(prLink.href).toBe(`https://github.com/${run.repo}/pull/${run.prNumber}`);

    expect(screen.getByText(run.branchName!)).toBeDefined();
  });

  it("omits the PR link and branch name when absent", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
  });

  it("renders Cursor, Claude Code, and Claude Desktop links when branchName and workingDirectory are both present", () => {
    const run = makeRun({
      branchName: "feature/flaky-fix",
      workingDirectory: "/work/acme-widgets",
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const cursorLink = screen.getByTitle("Open in Cursor") as HTMLAnchorElement;
    expect(cursorLink.href).toBe(`cursor://file${run.workingDirectory}`);

    const claudeCliLink = screen.getByTitle(
      "Open Claude Code session in this run's worktree",
    ) as HTMLAnchorElement;
    expect(claudeCliLink.href).toBe(
      `claude-cli://open?cwd=${encodeURIComponent(run.workingDirectory)}`,
    );

    const claudeDesktopLink = screen.getByTitle(
      "Open Claude Desktop (Code) in this run's worktree",
    ) as HTMLAnchorElement;
    expect(claudeDesktopLink.href).toBe(
      `claude://code/new?folder=${encodeURIComponent(run.workingDirectory)}`,
    );
  });

  it("omits the Cursor/Claude Code/Claude Desktop links when workingDirectory is empty", () => {
    const run = makeRun({ branchName: "feature/flaky-fix", workingDirectory: "" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(
      screen.queryByTitle("Open Claude Code session in this run's worktree"),
    ).toBeNull();
    expect(
      screen.queryByTitle("Open Claude Desktop (Code) in this run's worktree"),
    ).toBeNull();
  });

  it("omits the Cursor/Claude Code/Claude Desktop links when branchName is absent, even with a workingDirectory", () => {
    const run = makeRun({ branchName: null, workingDirectory: "/work/acme-widgets" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("shows the OpenQuestionsPanel with ALL open questions in HumanClarificationNeeded, and hides the AwaitingPlanApproval panel", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact = makePlanArtifact([requiredQuestion, optionalQuestion]);
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    // Scope to the OpenQuestionsPanel's <section aria-label="Open Questions">
    // (role "region") since the Plan tab (ArtifactTabs/PlanView), rendered
    // from the same artifact, also shows a plain "Open Questions" heading
    // and the same question text.
    const regions = screen.getAllByRole("region", { name: "Open Questions" });
    expect(regions).toHaveLength(1);
    const panel = within(regions[0]!);
    expect(panel.getByText(requiredQuestion.question)).toBeDefined();
    expect(panel.getByText(optionalQuestion.question)).toBeDefined();
  });

  it("shows the OpenQuestionsPanel with only optional questions in AwaitingPlanApproval", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const planArtifact = makePlanArtifact([requiredQuestion, optionalQuestion]);
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const panel = within(screen.getByRole("region", { name: "Open Questions" }));
    expect(panel.queryByText(requiredQuestion.question)).toBeNull();
    expect(panel.getByText(optionalQuestion.question)).toBeDefined();
  });

  it("shows neither OpenQuestionsPanel in a state that is neither HumanClarificationNeeded nor AwaitingPlanApproval", () => {
    const run = makeRun({ state: "Implementing" });
    const planArtifact = makePlanArtifact([requiredQuestion, optionalQuestion]);
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByRole("region", { name: "Open Questions" })).toBeNull();
  });

  it("shows neither OpenQuestionsPanel when the matching state has no open questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByRole("region", { name: "Open Questions" })).toBeNull();
  });

  it("wires ActionBar with hasOptionalQuestions=true when optional questions exist, regardless of which panel is shown", () => {
    const run = makeRun({ state: "Implementing" });
    const planArtifact = makePlanArtifact([requiredQuestion, optionalQuestion]);
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(capturedActionBarProps?.hasOptionalQuestions).toBe(true);
    expect(screen.getByTestId("action-bar-has-optional").textContent).toBe("true");
  });

  it("wires ActionBar with hasOptionalQuestions=false when there are no optional questions", () => {
    const run = makeRun({ state: "Implementing" });
    const planArtifact = makePlanArtifact([requiredQuestion]);
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(capturedActionBarProps?.hasOptionalQuestions).toBe(false);
  });

  it("passes runId and state through to ActionBar", () => {
    const run = makeRun({ state: "ReadyForHumanReview" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(capturedActionBarProps?.runId).toBe(run.id);
    expect(screen.getByTestId("action-bar-state").textContent).toBe("ReadyForHumanReview");
  });

  it("scrolls the questions panel into view when ActionBar triggers onScrollToQuestions", async () => {
    const user = userEvent.setup();
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const planArtifact = makePlanArtifact([requiredQuestion]);
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await user.click(screen.getByTestId("action-bar-scroll"));

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("does not throw when onScrollToQuestions fires but no questions panel is mounted", async () => {
    const user = userEvent.setup();
    const run = makeRun({ state: "Implementing" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await user.click(screen.getByTestId("action-bar-scroll"));
    // scrollIntoView is never called because questionsRef.current is null —
    // the optional chaining in scrollToQuestions must guard against this.
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("renders WorkflowStepper with the run's current state reflected in the labels", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Workflow")).toBeDefined();
    expect(screen.getByText("Awaiting Approval")).toBeDefined();
  });

  it("renders EventTimeline with the run's events", () => {
    const run = makeRun();
    const events: RunEventRecord[] = [
      {
        id: "ev1",
        runId: run.id,
        eventType: "RUN_REQUESTED",
        source: "human",
        payloadJson: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("renders ArtifactTabs with the run's artifacts", () => {
    const run = makeRun();
    const planArtifact = makePlanArtifact([]);
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
  });

  it("renders AgentOutputPanel when there is an active process", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue({
      processes: [
        {
          id: "proc-1",
          pid: 123,
          command: "claude",
          runId: run.id,
          stage: "Implementing",
          runtime: "claude-code",
          startedAt: "2026-01-01T00:00:00.000Z",
          elapsedMs: 0,
        },
      ],
      hasActive: true,
      output: "hello from the agent",
      activeProcessId: "proc-1",
    });
    renderPage();

    expect(screen.getByText("claude-code")).toBeDefined();
  });

  it("always renders ChatPanel wired with runId and artifacts", () => {
    const run = makeRun();
    const planArtifact = makePlanArtifact([]);
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("chat-panel").textContent).toContain(run.id);
    expect(screen.getByTestId("chat-panel").textContent).toContain("1 artifacts");
  });

  it("passes skills data/loading/error through to DistilledSkillPanel", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: true,
      error: "Failed to fetch run skills",
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId("distilled-skill-panel").textContent).toContain("loading=true");
    expect(screen.getByTestId("distilled-skill-panel").textContent).toContain(
      "error=Failed to fetch run skills",
    );
  });
});
