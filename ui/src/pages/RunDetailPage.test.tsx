import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const useRunMock = vi.fn();
const useActiveProcessesMock = vi.fn();
const useRunSkillsMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (id: string) => useRunMock(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => useRunSkillsMock(id),
}));
vi.mock("@/api/client.ts", async () => {
  const actual = await vi.importActual<typeof import("@/api/client.ts")>(
    "@/api/client.ts",
  );
  return {
    ...actual,
    api: {
      approvePlan: vi.fn(),
      rejectPlan: vi.fn(),
      approveReview: vi.fn(),
      pauseRun: vi.fn(),
      resumeRun: vi.fn(),
      submitOpenQuestionAnswers: vi.fn(),
    },
  };
});

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
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
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultActiveProcesses = {
  processes: [],
  hasActive: false,
  output: "",
  activeProcessId: null,
};
const defaultSkills = {
  data: null,
  loading: false,
  error: null,
  refetch: vi.fn(),
};

function renderPage(runId = "run-1") {
  return render(
    <MemoryRouter initialEntries={[`/runs/${runId}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  // This suite mounts the full RunDetailPage tree (many child components),
  // which can be slow under concurrent test-runner load; raise the
  // per-test timeout accordingly without touching the shared vitest config.
  vi.setConfig({ testTimeout: 20000 });

  beforeEach(() => {
    vi.clearAllMocks();
    useActiveProcessesMock.mockReturnValue(defaultActiveProcesses);
    useRunSkillsMock.mockReturnValue(defaultSkills);
  });

  it("shows the loading state", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows an error message when the hook errors", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "Network error",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("shows a 'Run not found' fallback when there is no error but no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details: id, issue, repo, branch, PR link, Linear link, and state", () => {
    useRunMock.mockReturnValue({
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
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("falls back to identifier and then a sliced issue id for the header issue label", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueId: "zzzzzzzz1234" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("zzzzzzzz")).toBeDefined();
  });

  it("omits branch/PR/Cursor/Claude links when the run has no branch or working directory", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ branchName: null, workingDirectory: "", prNumber: null, linearIssueUrl: null }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.queryByTitle("Open in Claude Code")).toBeNull();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows the open questions panel prominently in HumanClarificationNeeded", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
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
    useRunMock.mockReturnValue({
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
    const panel = within(screen.getByRole("region", { name: "Open Questions" }));
    expect(panel.getByText("Required?")).toBeDefined();
    expect(panel.getByText("Optional?")).toBeDefined();
  });

  it("shows only optional questions as a secondary panel in AwaitingPlanApproval", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
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
    useRunMock.mockReturnValue({
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
    const panel = within(screen.getByRole("region", { name: "Open Questions" }));
    expect(panel.queryByText("Required?")).toBeNull();
    expect(panel.getByText("Optional?")).toBeDefined();
  });

  it("scrolls to the open questions panel when the ActionBar's Answer Questions button is clicked", async () => {
    // jsdom doesn't implement scrollIntoView; stub it so the page's
    // scrollToQuestions handler can call it without throwing.
    Element.prototype.scrollIntoView = vi.fn();
    const user = userEvent.setup();
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
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

    await user.click(screen.getByRole("button", { name: /answer questions/i }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth", block: "start" }),
    );
  });

  it("renders with no plan artifact and no open questions panel at all", () => {
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "system",
        payloadJson: { to: "Planning" },
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    useRunMock.mockReturnValue({
      data: { run: makeRun({ state: "Planning" }), artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByText(/Required for execution/)).toBeNull();
    expect(screen.getByText("Workflow")).toBeDefined();
  });
});
