import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RunDetailPage } from "./RunDetailPage.tsx";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const mockUseRun = vi.fn();
const mockUseRunSkills = vi.fn();
const mockUseActiveProcesses = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({ useRun: () => mockUseRun() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: () => mockUseRunSkills() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: () => mockUseActiveProcesses(),
}));
vi.mock("@/hooks/useSSE.ts", () => ({ useSSE: () => {} }));

vi.mock("@/api/client.ts", () => ({
  api: {
    answerQuestions: vi.fn(),
    sendChatMessage: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    retryStage: vi.fn(),
    reReviewPlan: vi.fn(),
    revisePlan: vi.fn(),
  },
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "li-12345678",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "agentforge",
    branchName: "ai/run-1",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/repo",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage(runOverrides: Partial<Run> = {}, artifacts: Artifact[] = [], events: RunEventRecord[] = []) {
  mockUseRun.mockReturnValue({
    data: { run: makeRun(runOverrides), artifacts, events },
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseRunSkills.mockReturnValue({
    data: { injectedSkills: [], distillationDecision: null, distilledSkill: null },
    loading: false,
    error: null,
  });
  mockUseActiveProcesses.mockReturnValue({
    processes: [],
    hasActive: false,
    output: "",
    activeProcessId: null,
  });

  return render(
    <MemoryRouter initialEntries={["/runs/run-1"]}>
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
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    mockUseRunSkills.mockReturnValue({ data: null, loading: true, error: null });
    mockUseActiveProcesses.mockReturnValue({ processes: [], hasActive: false, output: "", activeProcessId: null });

    render(
      <MemoryRouter initialEntries={["/runs/run-1"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows an error message when the run fails to load", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: "not found", refetch: vi.fn() });
    mockUseRunSkills.mockReturnValue({ data: null, loading: false, error: null });
    mockUseActiveProcesses.mockReturnValue({ processes: [], hasActive: false, output: "", activeProcessId: null });

    render(
      <MemoryRouter initialEntries={["/runs/run-1"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("not found")).toBeDefined();
  });

  it("shows 'Run not found' when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    mockUseRunSkills.mockReturnValue({ data: null, loading: false, error: null });
    mockUseActiveProcesses.mockReturnValue({ processes: [], hasActive: false, output: "", activeProcessId: null });

    render(
      <MemoryRouter initialEntries={["/runs/run-1"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run header with issue, repo, branch, and PR links", () => {
    renderPage();

    expect(screen.getByText("Add login")).toBeDefined();
    expect(screen.getByText("agentforge")).toBeDefined();
    expect(screen.getByText("ai/run-1")).toBeDefined();
    expect(screen.getByTitle("Open PR on GitHub").textContent).toContain("42");
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("falls back to the issue identifier when there is no title", () => {
    renderPage({ linearIssueTitle: null });
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated issue id when neither title nor identifier exist", () => {
    renderPage({ linearIssueTitle: null, linearIssueIdentifier: null });
    expect(screen.getByText("li-12345")).toBeDefined();
  });

  it("shows the HumanClarificationNeeded questions panel prominently when there are blocking questions", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    renderPage({ state: "HumanClarificationNeeded" }, artifacts);

    expect(screen.getAllByText("Which DB?").length).toBeGreaterThan(0);
  });

  it("shows optional questions panel for AwaitingPlanApproval when optional questions exist", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [{ id: "q1", question: "Naming convention?", requiredForExecution: false }],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    renderPage({ state: "AwaitingPlanApproval" }, artifacts);

    expect(screen.getAllByText("Naming convention?").length).toBeGreaterThan(0);
  });

  it("renders the workflow stepper and event timeline", () => {
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "orchestrator",
        payloadJson: {},
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    renderPage({}, [], events);

    expect(screen.getByText("Workflow")).toBeDefined();
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("does not render the Cursor/Claude quick-open links without a branch and working directory", () => {
    renderPage({ branchName: null });
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle(/Claude Code session/)).toBeNull();
  });

  it("scrolls to the questions panel when the action bar's Answer Questions button is clicked", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });

    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: "run-1",
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    renderPage({ state: "HumanClarificationNeeded" }, artifacts);

    await userEvent.click(screen.getByRole("button", { name: /Answer Questions/ }));

    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });
});
