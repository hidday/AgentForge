import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const mockUseRun = vi.fn();
const mockUseRunSkills = vi.fn();
const mockUseActiveProcesses = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: (id: string) => mockUseRun(id) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => mockUseRunSkills(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => mockUseActiveProcesses(id),
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
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

let lastActionBarProps: Record<string, unknown> | null = null;
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: Record<string, unknown>) => {
    lastActionBarProps = props;
    return (
      <div data-testid="action-bar">
        <button onClick={() => (props.onScrollToQuestions as () => void)?.()}>
          scroll-to-questions
        </button>
      </div>
    );
  },
}));

let lastOpenQuestionsProps: Record<string, unknown>[] = [];
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: Record<string, unknown>) => {
    lastOpenQuestionsProps.push(props);
    return (
      <div data-testid="open-questions-panel">
        {(props.questions as { id: string }[]).map((q) => (
          <span key={q.id}>{q.id}</span>
        ))}
      </div>
    );
  },
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-123456789",
    linearIssueId: "issue-abcdefg",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/team/issue/ENG-42",
    repo: "org/repo",
    branchName: "agent/eng-42",
    prNumber: 7,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work/eng-42",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
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

const defaultSkills = { data: null, loading: false, error: null };
const defaultProcesses = { processes: [], output: "" };

describe("RunDetailPage", () => {
  beforeEach(() => {
    lastActionBarProps = null;
    lastOpenQuestionsProps = [];
    mockUseRun.mockReset();
    mockUseRunSkills.mockReset();
    mockUseActiveProcesses.mockReset();
    mockUseRunSkills.mockReturnValue(defaultSkills);
    mockUseActiveProcesses.mockReturnValue(defaultProcesses);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state and renders no header while loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });

    renderAt("run-1");

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByText("Run Detail")).toBeNull();
  });

  it("shows the error message when the fetch failed", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Run not found on server",
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(screen.getByText("Run not found on server")).toBeDefined();
  });

  it("shows a generic 'Run not found' message when there's no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });

    renderAt("run-1");

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("passes the route :id param through to useRun, useRunSkills, and useActiveProcesses", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-from-url-42");

    expect(mockUseRun).toHaveBeenCalledWith("run-from-url-42");
    expect(mockUseRunSkills).toHaveBeenCalledWith("run-from-url-42");
    expect(mockUseActiveProcesses).toHaveBeenCalledWith("run-from-url-42");
  });

  it("renders the run header: id, issue title, Linear link, repo, branch, PR link, and editor links", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-123456789");

    expect(screen.getByText("Run Detail")).toBeDefined();
    expect(screen.getByText("run-1234")).toBeDefined(); // run.id.slice(0, 8)
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("agent/eng-42")).toBeDefined();

    const linearLink = screen.getByRole("link", { name: /linear/i });
    expect(linearLink.getAttribute("href")).toBe("https://linear.app/team/issue/ENG-42");

    const prLink = screen.getByRole("link", { name: /pr #7/i });
    expect(prLink.getAttribute("href")).toBe("https://github.com/org/repo/pull/7");

    const cursorLink = screen.getByRole("link", { name: /cursor/i });
    expect(cursorLink.getAttribute("href")).toBe("cursor://file/work/eng-42");

    const claudeCliLink = screen.getByRole("link", { name: /claude code/i });
    expect(claudeCliLink.getAttribute("href")).toBe(
      `claude-cli://open?cwd=${encodeURIComponent("/work/eng-42")}`,
    );

    const claudeLink = screen.getByRole("link", { name: "Claude" });
    expect(claudeLink.getAttribute("href")).toBe(
      `claude://code/new?folder=${encodeURIComponent("/work/eng-42")}`,
    );
  });

  it("falls back to the issue identifier, then the issue id, when no Linear title is set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("run-1");
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back all the way to a sliced issue id when there is no title or identifier", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueTitle: null,
          linearIssueIdentifier: null,
          linearIssueId: "zzzzzzzz-long-id",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("run-1");
    expect(screen.getByText("zzzzzzzz")).toBeDefined();
  });

  it("omits optional links (Linear, PR, branch, editor links) when the run has no branch/PR/url", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueUrl: null,
          branchName: null,
          prNumber: null,
          workingDirectory: "",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("run-1");

    expect(screen.queryByRole("link", { name: /linear/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /pr #/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /cursor/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /claude code/i })).toBeNull();
  });

  it("renders child panels for a run with no open questions", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "Implementing" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("run-1");

    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("shows the full open-questions panel in HumanClarificationNeeded state", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required one?", requiredForExecution: true },
          { id: "q2", question: "Optional one?", requiredForExecution: false },
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

    renderAt("run-1");

    expect(screen.getByTestId("open-questions-panel")).toBeDefined();
    // Both required and optional questions are shown (full list) in this state.
    expect(screen.getByText("q1")).toBeDefined();
    expect(screen.getByText("q2")).toBeDefined();
    expect(lastOpenQuestionsProps[0]?.readOnly).toBe(false);
    expect(lastOpenQuestionsProps[0]?.runState).toBe("HumanClarificationNeeded");
  });

  it("shows only optional questions in AwaitingPlanApproval state, and tells ActionBar they exist", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required one?", requiredForExecution: true },
          { id: "q2", question: "Optional one?", requiredForExecution: false },
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

    renderAt("run-1");

    expect(screen.getByTestId("open-questions-panel")).toBeDefined();
    expect(screen.queryByText("q1")).toBeNull();
    expect(screen.getByText("q2")).toBeDefined();
    expect(lastActionBarProps?.hasOptionalQuestions).toBe(true);
  });

  it("does not show the open-questions panel in AwaitingPlanApproval when there are no optional questions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required one?", requiredForExecution: true },
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

    renderAt("run-1");

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(lastActionBarProps?.hasOptionalQuestions).toBe(false);
  });

  it("wires ActionBar's onScrollToQuestions to scroll the questions container into view", async () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required one?", requiredForExecution: true },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [planArtifact],
        events: [] as RunEventRecord[],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    renderAt("run-1");

    await userEvent.click(screen.getByRole("button", { name: "scroll-to-questions" }));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("passes the run id and state to ActionBar", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "ReadyForHumanReview" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("run-1");

    expect(lastActionBarProps?.runId).toBe("run-123456789");
    expect(lastActionBarProps?.state).toBe("ReadyForHumanReview");
  });
});
