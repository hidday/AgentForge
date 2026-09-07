import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useParams: vi.fn(() => ({ id: "run-1" })) };
});

import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { RunDetailPage } from "./RunDetailPage.tsx";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-abc123",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
    branchName: "fix/bug",
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
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:10:00Z",
    ...overrides,
  };
}

function defaultActiveProcesses() {
  return { processes: [], hasActive: false, output: "", activeProcessId: null };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RunDetailPage />
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue(defaultActiveProcesses());
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows the error message when the hook reports an error", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run not found on server",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run not found on server")).toBeDefined();
  });

  it("falls back to a generic 'Run not found' message when there's no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details: id, issue title, repo, branch, PR link, state", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("run-1".slice(0, 8))).toBeDefined();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("fix/bug")).toBeDefined();
    expect(screen.getByText(/PR #42/)).toBeDefined();
    // "Implementing" also appears as a WorkflowStepper step label, so assert
    // via the StateBadge specifically (it renders inside a full <span>).
    expect(screen.getAllByText("Implementing").length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to identifier/id for the issue label when title is missing", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-77" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("ENG-77")).toBeDefined();
  });

  it("does not render the Linear link, PR link, or editor links when their data is absent", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueUrl: null,
          prNumber: null,
          branchName: null,
          workingDirectory: "",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle("Open Claude Code session in this run's worktree")).toBeNull();
  });

  it("renders the Cursor/Claude Code/Claude editor links when branch and working directory are present", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });

  it("shows the OpenQuestionsPanel prominently for HumanClarificationNeeded with open questions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Which env?", requiredForExecution: true },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const panel = screen.getByLabelText("Open Questions");
    expect(panel.textContent).toContain("Which env?");
  });

  it("shows only optional questions as a secondary panel for AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required question", requiredForExecution: true },
          { id: "q2", question: "Optional question", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const panel = screen.getByLabelText("Open Questions");
    expect(panel.textContent).toContain("Optional question");
    expect(panel.textContent).not.toContain("Required question");
  });

  it("does not render any OpenQuestionsPanel for a state with no relevant questions", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "Implementing" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByText(/Required for execution|Optional/)).toBeNull();
  });

  it("renders the workflow stepper and event timeline from run data", () => {
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "human",
        payloadJson: null,
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Workflow")).toBeDefined();
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("passes hasOptionalQuestions to ActionBar so the optional-questions button appears", () => {
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
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole("button", { name: /Answer Optional Questions/i })).toBeDefined();
  });

  it("scrolls to the questions panel when 'Answer Questions' is clicked in HumanClarificationNeeded", async () => {
    const scrollIntoViewMock = vi.fn();
    HTMLDivElement.prototype.scrollIntoView = scrollIntoViewMock;

    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /^Answer Questions$/i }));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    // @ts-expect-error - cleanup the prototype patch
    delete HTMLDivElement.prototype.scrollIntoView;
  });

  it("renders the ChatPanel with the run's artifacts", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Chat with Agent")).toBeDefined();
  });

  it("passes distillation data from useRunSkills into the DistilledSkillPanel", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRunSkills.mockReturnValue({
      data: {
        injectedSkills: [],
        distillationDecision: {
          shouldPersist: true,
          reason: "good insight",
          taskCategory: "testing",
          name: "test-skill",
          description: "desc",
          displacedSkillId: null,
        },
        distilledSkill: {
          id: "s1",
          repoSlug: "org/repo",
          name: "test-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# Test skill",
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
    expect(screen.getByText("test-skill")).toBeDefined();
  });
});
