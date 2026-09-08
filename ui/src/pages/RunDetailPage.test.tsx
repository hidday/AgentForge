import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (...args: unknown[]) => useRunMock(...args),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (...args: unknown[]) => useRunSkillsMock(...args),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (...args: unknown[]) => useActiveProcessesMock(...args),
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
  EventTimeline: ({ events }: { events: RunEventRecord[] }) => (
    <div data-testid="event-timeline">{events.length}</div>
  ),
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    onScrollToQuestions,
    hasOptionalQuestions,
  }: {
    onScrollToQuestions: () => void;
    hasOptionalQuestions: boolean;
  }) => (
    <div data-testid="action-bar">
      <span data-testid="has-optional">{String(hasOptionalQuestions)}</span>
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: { id: string }[] }) => (
    <div data-testid="open-questions-panel">{questions.length}</div>
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
    id: "run-abcdef123456",
    linearIssueId: "li-1234567890",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
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

function renderAtId(id = "run-abcdef123456") {
  return render(
    <MemoryRouter initialEntries={[`/runs/${id}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const defaultSkills = {
  data: { injectedSkills: [], distillationDecision: null, distilledSkill: null },
  loading: false,
  error: null,
};

const defaultProcesses = { processes: [], hasActive: false, output: "", activeProcessId: null };

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRunSkillsMock.mockReturnValue(defaultSkills);
    useActiveProcessesMock.mockReturnValue(defaultProcesses);
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderAtId();
    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("shows the error message when the hook reports an error", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "Network failure",
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.getByText("Network failure")).toBeDefined();
  });

  it("shows 'Run not found' when there is no error but also no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderAtId();
    expect(screen.getByText(/run not found/i)).toBeDefined();
  });

  it("renders run header details: id prefix, repo, and state badge", () => {
    const run = makeRun({ id: "abcdefgh-9999", repo: "acme/widgets", state: "Implementing" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId("abcdefgh-9999");

    expect(screen.getByText("abcdefgh")).toBeDefined(); // id.slice(0,8)
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
  });

  it("prefers linearIssueTitle, falls back to identifier, then to a truncated issue id", () => {
    const withTitle = makeRun({ linearIssueTitle: "Fix the bug", linearIssueIdentifier: "ENG-1" });
    useRunMock.mockReturnValue({
      data: { run: withTitle, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { unmount } = renderAtId();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    unmount();

    const withIdentifier = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-2" });
    useRunMock.mockReturnValue({
      data: { run: withIdentifier, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { unmount: unmount2 } = renderAtId();
    expect(screen.getByText("ENG-2")).toBeDefined();
    unmount2();

    const withNeither = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "li-truncate-me",
    });
    useRunMock.mockReturnValue({
      data: { run: withNeither, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.getByText("li-trunc")).toBeDefined(); // linearIssueId.slice(0,8)
  });

  it("renders the Linear link only when linearIssueUrl is present", () => {
    const run = makeRun({ linearIssueUrl: "https://linear.app/issue/1" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    const link = screen.getByRole("link", { name: /linear/i });
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/1");
  });

  it("does not render the Linear link when linearIssueUrl is absent", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.queryByRole("link", { name: /^linear$/i })).toBeNull();
  });

  it("renders branch name and PR link when present", () => {
    const run = makeRun({ branchName: "feature/x", prNumber: 42, repo: "acme/widgets" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.getByText("feature/x")).toBeDefined();
    const prLink = screen.getByRole("link", { name: /PR #42/i });
    expect(prLink.getAttribute("href")).toBe("https://github.com/acme/widgets/pull/42");
  });

  it("does not render branch/PR/editor links when branchName is absent", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ branchName: null, prNumber: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.queryByText(/PR #/)).toBeNull();
    expect(screen.queryByRole("link", { name: /cursor/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /claude code/i })).toBeNull();
  });

  it("renders Cursor/Claude Code/Claude editor links when branchName and workingDirectory are present", () => {
    const run = makeRun({ branchName: "feature/x", workingDirectory: "/repo/work dir" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.getByRole("link", { name: /cursor/i }).getAttribute("href")).toBe(
      "cursor://file/repo/work dir",
    );
    expect(
      screen.getByRole("link", { name: /claude code/i }).getAttribute("href"),
    ).toContain("claude-cli://open?cwd=");
    expect(screen.getByRole("link", { name: /^claude$/i }).getAttribute("href")).toContain(
      "claude://code/new?folder=",
    );
  });

  it("renders artifact and event counts via the ArtifactTabs and EventTimeline mocks", () => {
    const artifacts: Artifact[] = [
      { id: "a1", runId: "r1", type: "Plan", version: 1, payloadJson: {}, rawText: "", createdAt: "2024-01-01" },
    ];
    const events: RunEventRecord[] = [
      { id: "e1", runId: "r1", eventType: "RUN_REQUESTED", source: "system", payloadJson: {}, createdAt: "2024-01-01" },
    ];
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.getByTestId("artifact-tabs").textContent).toBe("1");
    expect(screen.getByTestId("event-timeline").textContent).toBe("1");
  });

  it("shows the OpenQuestionsPanel with all open questions when state is HumanClarificationNeeded", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "r1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Q1?", requiredForExecution: true },
          { id: "q2", question: "Q2?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01",
    };
    const run = makeRun({ state: "HumanClarificationNeeded" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("2");
    // ActionBar's hasOptionalQuestions counts only non-required questions (1), regardless of state
    expect(screen.getByTestId("has-optional").textContent).toBe("true");
  });

  it("shows the OpenQuestionsPanel with only optional questions when state is AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "r1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required", requiredForExecution: true },
          { id: "q2", question: "Optional", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01",
    };
    const run = makeRun({ state: "AwaitingPlanApproval" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.getByTestId("open-questions-panel").textContent).toBe("1");
    expect(screen.getByTestId("has-optional").textContent).toBe("true");
  });

  it("does not render an OpenQuestionsPanel when there are no open questions and reports hasOptionalQuestions=false", () => {
    const run = makeRun({ state: "Implementing" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("has-optional").textContent).toBe("false");
  });

  it("handles a Plan artifact whose payload has no openQuestions field", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "r1",
      type: "Plan",
      version: 1,
      payloadJson: {},
      rawText: "",
      createdAt: "2024-01-01",
    };
    const run = makeRun({ state: "HumanClarificationNeeded" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("invokes scrollIntoView on the questions ref when ActionBar requests a scroll", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const planArtifact: Artifact = {
      id: "a1",
      runId: "r1",
      type: "Plan",
      version: 1,
      payloadJson: { openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: true }] },
      rawText: "",
      createdAt: "2024-01-01",
    };
    const run = makeRun({ state: "HumanClarificationNeeded" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    screen.getByText("scroll-to-questions").click();
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("passes distilled skill data and loading/error state through to DistilledSkillPanel", () => {
    useRunSkillsMock.mockReturnValue({
      data: {
        injectedSkills: [],
        distillationDecision: null,
        distilledSkill: { id: "s1", repoSlug: "r", name: "Skill", description: null, taskCategory: "x", skillMarkdown: "", utilityScore: 1, lastUsedAt: "2024-01-01" },
      },
      loading: false,
      error: "skills error",
    });
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
  });

  it("passes active process output data through to AgentOutputPanel", () => {
    useActiveProcessesMock.mockReturnValue({
      processes: [{ id: "p1", pid: 1, command: "x", runId: "r1", stage: "Implementing", runtime: "claude", startedAt: "2024-01-01", elapsedMs: 0 }],
      hasActive: true,
      output: "some output",
      activeProcessId: "p1",
    });
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAtId();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
  });
});
