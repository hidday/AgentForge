import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <div data-testid="state-badge">{state}</div>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: () => <div data-testid="workflow-stepper" />,
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
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({
    onScrollToQuestions,
    hasOptionalQuestions,
  }: {
    onScrollToQuestions: () => void;
    hasOptionalQuestions: boolean;
  }) => (
    <div data-testid="action-bar" data-has-optional={String(hasOptionalQuestions)}>
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: { id: string }[] }) => (
    <div data-testid="open-questions-panel">{questions.map((q) => q.id).join(",")}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

import { useRun } from "@/hooks/useRun.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { RunDetailPage } from "./RunDetailPage.tsx";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-abc12345",
    repo: "org/repo",
    state: "Implementing",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ISSUE-1",
    linearIssueTitle: null,
    linearIssueUrl: null,
    branchName: null,
    workingDirectory: null,
    prNumber: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderWithRoute(id = "run-abc12345") {
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
    mockUseActiveProcesses.mockReturnValue({ processes: [], hasActive: false, output: "", activeProcessId: null });
    mockUseRunSkills.mockReturnValue({ data: null, loading: false, error: null });
  });

  it("shows the loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });

    renderWithRoute();

    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("workflow-stepper")).toBeNull();
  });

  it("shows the error message when the fetch failed", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: "Network error", refetch: vi.fn() });

    renderWithRoute();

    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("shows a 'Run not found' fallback when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });

    renderWithRoute();

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the full layout with run details once data loads", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithRoute();

    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByText("run-abc1")).toBeDefined(); // id.slice(0, 8)
    expect(screen.getByText("ISSUE-1")).toBeDefined();
  });

  it("falls back from linearIssueTitle to linearIssueIdentifier to a truncated id", () => {
    const run = makeRun({ linearIssueIdentifier: null, linearIssueId: "issue-longid-1234" });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithRoute();

    expect(screen.getByText("issue-lo")).toBeDefined(); // linearIssueId.slice(0, 8)
  });

  it("renders the Linear link only when linearIssueUrl is present", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ linearIssueUrl: "https://linear.app/issue/1" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithRoute();

    expect(screen.getByRole("link", { name: /linear/i })).toBeDefined();
  });

  it("does not render the Linear link when linearIssueUrl is absent", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ linearIssueUrl: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithRoute();

    expect(screen.queryByRole("link", { name: /linear/i })).toBeNull();
  });

  it("renders branch, PR, Cursor and Claude links when branchName/workingDirectory/prNumber are set", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: makeRun({
          branchName: "feature/foo",
          workingDirectory: "/tmp/work",
          prNumber: 42,
          repo: "org/repo",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithRoute();

    expect(screen.getByText("feature/foo")).toBeDefined();
    expect(screen.getByRole("link", { name: /pr #42/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /cursor/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /claude code/i })).toBeDefined();
    expect(screen.getByRole("link", { name: "Claude" })).toBeDefined();
  });

  it("does not render branch/PR/editor links when their fields are absent", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithRoute();

    expect(screen.queryByRole("link", { name: /pr #/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /cursor/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /claude code/i })).toBeNull();
  });

  it("shows the OpenQuestionsPanel with all open questions when state is HumanClarificationNeeded", () => {
    const planArtifact = {
      id: "a1",
      type: "Plan",
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Q1", requiredForExecution: true },
          { id: "q2", question: "Q2", requiredForExecution: false },
        ],
      },
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

    renderWithRoute();

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("q1,q2");
    expect(screen.getByTestId("action-bar").getAttribute("data-has-optional")).toBe("true");
  });

  it("shows only optional questions in the panel when state is AwaitingPlanApproval", () => {
    const planArtifact = {
      id: "a1",
      type: "Plan",
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Q1", requiredForExecution: true },
          { id: "q2", question: "Q2", requiredForExecution: false },
        ],
      },
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

    renderWithRoute();

    expect(screen.getByTestId("open-questions-panel").textContent).toBe("q2");
  });

  it("does not render any OpenQuestionsPanel when there is no Plan artifact", () => {
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "HumanClarificationNeeded" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithRoute();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
    expect(screen.getByTestId("action-bar").getAttribute("data-has-optional")).toBe("false");
  });

  it("does not render OpenQuestionsPanel for states other than HumanClarificationNeeded/AwaitingPlanApproval", () => {
    const planArtifact = {
      id: "a1",
      type: "Plan",
      payloadJson: { openQuestions: [{ id: "q1", question: "Q1", requiredForExecution: true }] },
    };
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "Implementing" }), artifacts: [planArtifact], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithRoute();

    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });
});
