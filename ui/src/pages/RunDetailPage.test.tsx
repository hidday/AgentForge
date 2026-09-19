import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import { RunDetailPage } from "./RunDetailPage.tsx";

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
vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: () => {},
}));
vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn().mockResolvedValue({ ok: true }),
    rejectPlan: vi.fn().mockResolvedValue({ ok: true }),
    reReviewPlan: vi.fn().mockResolvedValue({ ok: true }),
    revisePlan: vi.fn().mockResolvedValue({ ok: true }),
    approveReview: vi.fn().mockResolvedValue({ ok: true }),
    pauseRun: vi.fn().mockResolvedValue({ ok: true }),
    resumeRun: vi.fn().mockResolvedValue({ ok: true }),
    retryStage: vi.fn().mockResolvedValue({ ok: true }),
    answerQuestions: vi.fn().mockResolvedValue({ ok: true, run: {} }),
    sendChatMessage: vi.fn().mockResolvedValue({ reply: "", durationMs: 0 }),
  },
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-abcdefgh-1234",
    linearIssueId: "issue-abcdef12",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the widget",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
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

function makeArtifact(type: string, payloadJson: unknown, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `${type}-1`,
    runId: "run-abcdefgh-1234",
    type,
    version: 1,
    payloadJson,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function setHookDefaults() {
  mockUseRun.mockReturnValue({
    data: { run: makeRun(), artifacts: [], events: [] as RunEventRecord[] },
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
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
}

function renderPage(runId = "run-abcdefgh-1234") {
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
    vi.clearAllMocks();
    setHookDefaults();
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows the error message when the run fetch fails", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run fetch failed",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run fetch failed")).toBeDefined();
  });

  it("shows a generic 'Run not found' message when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run id, issue title, repo, and created timestamp in the header", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("run-abcd")).toBeDefined();
    expect(screen.getByText("Fix the widget")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText(/^Created /)).toBeDefined();
  });

  it("falls back to the issue identifier, then a truncated id, when no title is set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { rerender } = renderPage();
    expect(screen.getByText("ENG-42")).toBeDefined();

    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: null }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    rerender(
      <MemoryRouter initialEntries={["/runs/run-abcdefgh-1234"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("issue-ab")).toBeDefined();
  });

  it("shows the Linear link only when linearIssueUrl is set", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ linearIssueUrl: "https://linear.app/x" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { rerender } = renderPage();
    expect(screen.getByTitle("Open in Linear")).toBeDefined();

    mockUseRun.mockReturnValue({
      data: { run: makeRun({ linearIssueUrl: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    rerender(
      <MemoryRouter initialEntries={["/runs/run-abcdefgh-1234"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows the branch, PR, and worktree action links only when branchName is set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ branchName: "feature/x", prNumber: 7 }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("feature/x")).toBeDefined();
    expect(screen.getByTitle("Open PR on GitHub")).toBeDefined();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });

  it("hides branch/PR/worktree links when branchName is null", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ branchName: null, prNumber: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle("Open Claude Code session in this run's worktree")).toBeNull();
    expect(screen.queryByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeNull();
  });

  it("hides the PR link when branchName is set but prNumber is null", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ branchName: "feature/x", prNumber: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
  });

  it("shows the open questions panel prominently for HumanClarificationNeeded with required questions", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [
          makeArtifact("Plan", {
            openQuestions: [
              { id: "q1", question: "Which DB?", requiredForExecution: true },
            ],
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    // "Which DB?" also appears in the Plan tab's own read-only open
    // questions section; scope to the interactive panel.
    const panel = screen.getByRole("region", { name: "Open Questions" });
    expect(within(panel).getByText("Which DB?")).toBeDefined();
  });

  it("does not show the prominent questions panel for HumanClarificationNeeded when there are none", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("shows only optional questions in the secondary panel for AwaitingPlanApproval", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [
          makeArtifact("Plan", {
            openQuestions: [
              { id: "q1", question: "Required one", requiredForExecution: true },
              { id: "q2", question: "Optional one", requiredForExecution: false },
            ],
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    // "Optional one" also appears read-only inside the Plan tab's own open
    // questions section (via ArtifactTabs/PlanView), so scope this assertion
    // to the interactive OpenQuestionsPanel itself.
    const panel = screen.getByRole("region", { name: "Open Questions" });
    expect(within(panel).getByText("Optional one")).toBeDefined();
    expect(within(panel).queryByText("Required one")).toBeNull();
    // ActionBar should surface the "Answer Optional Questions" button too.
    expect(screen.getByRole("button", { name: /answer optional questions/i })).toBeDefined();
  });

  it("does not show the optional questions panel or button when there are no optional questions", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [
          makeArtifact("Plan", {
            openQuestions: [
              { id: "q1", question: "Required one", requiredForExecution: true },
            ],
          }),
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
  });

  it("handles a Plan artifact with no openQuestions field without crashing", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [makeArtifact("Plan", { summary: "no questions field" })],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole("button", { name: /answer optional questions/i })).toBeNull();
  });

  it("handles having no Plan artifact at all without crashing", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "AwaitingPlanApproval" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Fix the widget")).toBeDefined();
  });

  it("renders the workflow stepper, artifact tabs, event timeline, and chat panel", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun(),
        artifacts: [makeArtifact("Plan", { summary: "The plan" })],
        events: [
          {
            id: "e1",
            runId: "run-abcdefgh-1234",
            eventType: "RUN_REQUESTED",
            source: "system",
            payloadJson: null,
            createdAt: "2024-01-01T00:00:00Z",
          },
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Workflow")).toBeDefined();
    expect(screen.getByText("The plan")).toBeDefined();
    expect(screen.getByText("Run Requested")).toBeDefined();
    expect(screen.getByText("Chat with Agent")).toBeDefined();
  });

  it("passes distilled skill data through to the DistilledSkillPanel", () => {
    mockUseRunSkills.mockReturnValue({
      data: {
        injectedSkills: [],
        distillationDecision: {
          shouldPersist: true,
          reason: "insight",
          taskCategory: "cat",
          name: "my-skill",
          description: "desc",
          displacedSkillId: null,
        },
        distilledSkill: {
          id: "s1",
          repoSlug: "org/repo",
          name: "my-skill",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "# doc",
          utilityScore: 0,
          lastUsedAt: "2024-01-01T00:00:00Z",
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Distilled Skill")).toBeDefined();
  });

  it("renders the active-process agent output panel when a process is active", () => {
    mockUseActiveProcesses.mockReturnValue({
      processes: [
        {
          id: "p1",
          pid: 1,
          command: "claude",
          runId: "run-abcdefgh-1234",
          stage: "Implementing",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          elapsedMs: 0,
        },
      ],
      hasActive: true,
      output: "",
      activeProcessId: "p1",
    });
    renderPage();
    expect(screen.getByText("claude-code")).toBeDefined();
  });

  it("scrolls the open questions panel into view when 'Answer Questions' is clicked", async () => {
    const scrollIntoViewMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoViewMock,
      writable: true,
      configurable: true,
    });

    try {
      mockUseRun.mockReturnValue({
        data: {
          run: makeRun({ state: "HumanClarificationNeeded" }),
          artifacts: [
            makeArtifact("Plan", {
              openQuestions: [
                { id: "q1", question: "Which DB?", requiredForExecution: true },
              ],
            }),
          ],
          events: [],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderPage();

      await userEvent.click(screen.getByRole("button", { name: /answer questions/i }));

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    } finally {
      // @ts-expect-error test-only cleanup
      delete HTMLElement.prototype.scrollIntoView;
    }
  });

  it("renders the ActionBar with state-appropriate actions", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "ReadyForHumanReview" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole("button", { name: /approve & complete/i })).toBeDefined();
  });
});
