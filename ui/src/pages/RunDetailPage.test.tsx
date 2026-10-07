import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useParams: vi.fn(),
  };
});

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: vi.fn(),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: vi.fn(),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: vi.fn(),
}));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <span data-testid="state-badge">{state}</span>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: () => <div data-testid="workflow-stepper" />,
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{artifacts.length}</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ onScrollToQuestions }: { onScrollToQuestions?: () => void }) => (
    <div data-testid="action-bar">
      <button onClick={onScrollToQuestions}>trigger-scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: unknown[] }) => (
    <div data-testid="open-questions-panel">{questions.length}</div>
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
  id: "run-abc12345",
  linearIssueId: "li-1",
  linearIssueIdentifier: "ENG-1",
  linearIssueDescription: null,
  linearIssueTitle: "Fix the thing",
  linearIssueUrl: "https://linear.app/issue/ENG-1",
  repo: "org/repo",
  branchName: "fix/thing",
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
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

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
    mockUseParams.mockReturnValue({ id: "run-abc12345" });
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
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("shows an error message when the run failed to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run not found",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("shows a 'Run not found' fallback when there's no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run details for a valid run id", () => {
    const artifacts: Artifact[] = [];
    const events: RunEventRecord[] = [];
    mockUseRun.mockReturnValue({
      data: { run: BASE_RUN, artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("fix/thing")).toBeDefined();
    expect(screen.getByText("PR #42")).toBeDefined();
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
  });

  it("shows the open questions panel for HumanClarificationNeeded with required questions", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-abc12345",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
            { id: "q2", question: "Optional?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: {
        run: { ...BASE_RUN, state: "HumanClarificationNeeded" },
        artifacts,
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // All open questions (required + optional) are shown for HumanClarificationNeeded.
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2");
  });

  it("shows only optional questions for AwaitingPlanApproval", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-abc12345",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Required", requiredForExecution: true },
            { id: "q2", question: "Optional one", requiredForExecution: false },
            { id: "q3", question: "Optional two", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: {
        run: { ...BASE_RUN, state: "AwaitingPlanApproval" },
        artifacts,
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2");
  });

  it("does not render the open questions panel when there is no Plan artifact", () => {
    mockUseRun.mockReturnValue({
      data: { run: { ...BASE_RUN, state: "AwaitingPlanApproval" }, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("omits branch/PR/open-in-editor links when the run has no branch name", () => {
    mockUseRun.mockReturnValue({
      data: { run: { ...BASE_RUN, branchName: null, prNumber: null }, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByText(/PR #/)).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("renders the Linear issue identifier when there's no title", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: { ...BASE_RUN, linearIssueTitle: null, linearIssueUrl: null },
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a slice of linearIssueId when both title and identifier are absent", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: {
          ...BASE_RUN,
          linearIssueTitle: null,
          linearIssueIdentifier: null,
          linearIssueId: "abcdefgh12345",
          linearIssueUrl: null,
        },
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

  it("scrolls to the open-questions section when ActionBar requests it", async () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-abc12345",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run: { ...BASE_RUN, state: "HumanClarificationNeeded" }, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = (
      window.HTMLElement.prototype as unknown as { scrollIntoView?: () => void }
    ).scrollIntoView;
    (window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      scrollIntoViewMock;

    try {
      await userEvent.click(screen.getByRole("button", { name: "trigger-scroll-to-questions" }));
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    } finally {
      (window.HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView =
        originalScrollIntoView;
    }
  });

  it("passes active process state through to AgentOutputPanel", () => {
    mockUseActiveProcesses.mockReturnValue({
      processes: [{ id: "p1" }],
      hasActive: true,
      output: "some output",
      activeProcessId: "p1",
    });
    mockUseRun.mockReturnValue({
      data: { run: BASE_RUN, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
  });
});
