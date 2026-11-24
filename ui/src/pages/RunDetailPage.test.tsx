import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <div>StateBadge:{state}</div>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: () => <div>WorkflowStepper</div>,
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: () => <div>ArtifactTabs</div>,
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div>AgentOutputPanel</div>,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: () => <div>EventTimeline</div>,
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ onScrollToQuestions }: { onScrollToQuestions?: () => void }) => (
    <div>
      ActionBar
      <button onClick={onScrollToQuestions}>Scroll To Questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: unknown[] }) => (
    <div>OpenQuestionsPanel:{questions.length}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div>ChatPanel</div>,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div>DistilledSkillPanel</div>,
}));

import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { RunDetailPage } from "./RunDetailPage.tsx";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    linearIssueId: "i1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
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
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/r1"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRunSkills.mockReturnValue({ data: null, loading: false, error: null });
    mockUseActiveProcesses.mockReturnValue({ processes: [], output: "" });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows an error message when the run fails to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run not found",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("falls back to 'Run not found' when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run header and all panels once data loads", () => {
    const artifacts: Artifact[] = [];
    const events: RunEventRecord[] = [];
    mockUseRun.mockReturnValue({
      data: { run: run(), artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("StateBadge:Implementing")).toBeDefined();
    expect(screen.getByText("WorkflowStepper")).toBeDefined();
    expect(screen.getByText("ArtifactTabs")).toBeDefined();
    expect(screen.getByText("AgentOutputPanel")).toBeDefined();
    expect(screen.getByText("EventTimeline")).toBeDefined();
    expect(screen.getByText("ActionBar")).toBeDefined();
    expect(screen.getByText("ChatPanel")).toBeDefined();
    expect(screen.getByText("DistilledSkillPanel")).toBeDefined();
  });

  it("falls back to the identifier when no linear issue title is set", () => {
    mockUseRun.mockReturnValue({
      data: { run: run({ linearIssueTitle: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a slice of the raw linearIssueId when title and identifier are both missing", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: run({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueId: "abcdefgh12345" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows the Linear link only when linearIssueUrl is set", () => {
    mockUseRun.mockReturnValue({
      data: { run: run({ linearIssueUrl: "https://linear.app/x" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("shows the branch name and GitHub PR link only when set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: run({ branchName: "feature/x", prNumber: 7 }),
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
  });

  it("shows the Cursor and Claude Code deep links only when branch + workingDirectory are set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: run({ branchName: "feature/x", workingDirectory: "/work/dir" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(
      screen.getByTitle("Open Claude Desktop (Code) in this run's worktree"),
    ).toBeDefined();
  });

  it("shows the OpenQuestionsPanel prominently when HumanClarificationNeeded with open questions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "r1",
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
        run: run({ state: "HumanClarificationNeeded" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("OpenQuestionsPanel:1")).toBeDefined();
  });

  it("shows only optional open questions in AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "r1",
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
    mockUseRun.mockReturnValue({
      data: {
        run: run({ state: "AwaitingPlanApproval" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("OpenQuestionsPanel:1")).toBeDefined();
  });

  it("scrolls the questions panel into view when the ActionBar requests it", async () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "r1",
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
        run: run({ state: "HumanClarificationNeeded" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Scroll To Questions" }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("does not render an OpenQuestionsPanel when there is no Plan artifact", () => {
    mockUseRun.mockReturnValue({
      data: { run: run({ state: "HumanClarificationNeeded" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByText(/OpenQuestionsPanel/)).toBeNull();
  });
});
