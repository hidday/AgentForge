import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RunDetailPage } from "./RunDetailPage.tsx";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));

// Mock every heavy child so this test exercises RunDetailPage's own logic
// (header fields, loading/error states, open-questions branching, prop
// wiring) rather than re-testing components other test files already own.
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: (props: { currentState: string }) => (
    <div data-testid="workflow-stepper">{props.currentState}</div>
  ),
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: (props: { artifacts: Artifact[] }) => (
    <div data-testid="artifact-tabs">{props.artifacts.length} artifacts</div>
  ),
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: (props: { output: string }) => (
    <div data-testid="agent-output">{props.output}</div>
  ),
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: (props: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{props.events.length} events</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: {
    state: string;
    hasOptionalQuestions: boolean;
    onScrollToQuestions: () => void;
  }) => (
    <div data-testid="action-bar">
      <span>{props.state}</span>
      <button onClick={props.onScrollToQuestions}>scroll-to-questions</button>
      <span data-testid="has-optional">{String(props.hasOptionalQuestions)}</span>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: {
    questions: Array<{ id: string; question: string }>;
    readOnly: boolean;
  }) => (
    <div data-testid="open-questions">
      {props.questions.map((q) => (
        <div key={q.id}>{q.question}</div>
      ))}
    </div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: (props: { runId: string }) => (
    <div data-testid="chat-panel">chat for {props.runId}</div>
  ),
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: (props: { loading: boolean; error: string | null }) => (
    <div data-testid="distilled-skill">
      loading={String(props.loading)} error={String(props.error)}
    </div>
  ),
}));

import { useRun } from "@/hooks/useRun.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-123abcde",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderAt(id: string) {
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
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByText("Loading run...")).toBeDefined();
    expect(screen.queryByText("Run Detail")).toBeNull();
  });

  it("shows an error message when the run fails to load", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Network error",
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("shows a not-found message when loading finished but no data and no error", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details: id, issue, repo, and state", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun(),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-123abcde");

    expect(screen.getByText("Run Detail")).toBeDefined();
    expect(screen.getByText("run-123a")).toBeDefined(); // run.id.slice(0, 8)
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/repo")).toBeDefined();
    expect(screen.getByTestId("workflow-stepper").textContent).toBe("Implementing");
  });

  it("falls back to the Linear issue identifier when no issue title is set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-42" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByText("ENG-42")).toBeDefined();
  });

  it("falls back to a slice of the raw Linear issue id when neither title nor identifier is set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueTitle: null,
          linearIssueIdentifier: null,
          linearIssueId: "abcdefgh-1234",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("does not render optional link buttons when branchName/prNumber/workingDirectory link fields are absent", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("renders branch, PR, and IDE links when present on the run", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({
          branchName: "feature/foo",
          prNumber: 7,
          workingDirectory: "/work/dir",
          linearIssueUrl: "https://linear.app/issue/ENG-1",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByText("feature/foo")).toBeDefined();
    const prLink = screen.getByTitle("Open PR on GitHub");
    expect(prLink.getAttribute("href")).toBe("https://github.com/acme/repo/pull/7");
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(
      screen.getByTitle("Open Claude Code session in this run's worktree"),
    ).toBeDefined();
    expect(
      screen.getByTitle("Open Claude Desktop (Code) in this run's worktree"),
    ).toBeDefined();
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("shows the OpenQuestionsPanel prominently for HumanClarificationNeeded with open questions", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [
          {
            id: "a1",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: {
              openQuestions: [
                { id: "q1", question: "Required question?", requiredForExecution: true },
                { id: "q2", question: "Optional question?", requiredForExecution: false },
              ],
            },
            rawText: "",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    const panel = screen.getByTestId("open-questions");
    expect(panel.textContent).toContain("Required question?");
    expect(panel.textContent).toContain("Optional question?");
  });

  it("shows only optional questions in the secondary panel for AwaitingPlanApproval", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [
          {
            id: "a1",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: {
              openQuestions: [
                { id: "q1", question: "Required question?", requiredForExecution: true },
                { id: "q2", question: "Optional question?", requiredForExecution: false },
              ],
            },
            rawText: "",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    const panel = screen.getByTestId("open-questions");
    expect(panel.textContent).toContain("Optional question?");
    expect(panel.textContent).not.toContain("Required question?");
    expect(screen.getByTestId("has-optional").textContent).toBe("true");
  });

  it("renders no OpenQuestionsPanel and hasOptionalQuestions=false when there are no open questions", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "Implementing" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.queryByTestId("open-questions")).toBeNull();
    expect(screen.getByTestId("has-optional").textContent).toBe("false");
  });

  it("scrolls to the questions panel when the ActionBar requests it", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [
          {
            id: "a1",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: {
              openQuestions: [
                { id: "q1", question: "Required question?", requiredForExecution: true },
              ],
            },
            rawText: "",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    await user.click(screen.getByText("scroll-to-questions"));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("wires artifact and event counts, active-process output, and skills loading/error through to children", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun(),
        artifacts: [
          { id: "a1", runId: "run-1", type: "Plan", version: 1, payloadJson: {}, rawText: "", createdAt: "" },
          { id: "a2", runId: "run-1", type: "Review", version: 1, payloadJson: {}, rawText: "", createdAt: "" },
        ],
        events: [
          { id: "e1", runId: "run-1", eventType: "run:created", source: "system", payloadJson: {}, createdAt: "" },
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "some agent output",
      activeProcessId: null,
    });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: true,
      error: "skills failed",
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByTestId("artifact-tabs").textContent).toBe("2 artifacts");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1 events");
    expect(screen.getByTestId("agent-output").textContent).toBe("some agent output");
    expect(screen.getByTestId("distilled-skill").textContent).toContain("loading=true");
    expect(screen.getByTestId("distilled-skill").textContent).toContain("error=skills failed");
    expect(screen.getByTestId("chat-panel").textContent).toBe("chat for run-123abcde");
  });
});
