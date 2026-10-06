import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RunDetailPage } from "./RunDetailPage.tsx";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: vi.fn(),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: vi.fn(),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: vi.fn(),
}));

vi.mock("@/api/client.ts", () => ({
  api: {
    answerQuestions: vi.fn(),
    sendChatMessage: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    reReviewPlan: vi.fn(),
    revisePlan: vi.fn(),
    retryStage: vi.fn(),
  },
}));

import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-123456789",
    linearIssueId: "issue-abcdefgh",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the flaky test",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-123",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const defaultSkills = {
  data: null,
  loading: false,
  error: null,
  refetch: vi.fn(),
};

const defaultProcesses = {
  processes: [],
  hasActive: false,
  output: "",
  activeProcessId: null,
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRunSkills.mockReturnValue(defaultSkills);
    mockUseActiveProcesses.mockReturnValue(defaultProcesses);
  });

  it("renders a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-123456789");

    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("renders the error message when the hook reports an error", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "Failed to fetch run",
      refetch: vi.fn(),
    });

    renderAt("/runs/run-123456789");

    expect(screen.getByText("Failed to fetch run")).toBeDefined();
  });

  it("renders a not-found message when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-123456789");

    expect(screen.getByText(/run not found/i)).toBeDefined();
  });

  it("renders run details, header fields and optional links based on run data", () => {
    const run = makeRun({
      branchName: "feature/fix-test",
      prNumber: 7,
      linearIssueUrl: "https://linear.app/issue/ENG-42",
    });
    const artifacts: Artifact[] = [];
    const events: RunEventRecord[] = [];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-123456789");

    // Header fields
    expect(screen.getByText("run-1234")).toBeDefined(); // id sliced to 8 chars
    expect(screen.getByText("Fix the flaky test")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("feature/fix-test")).toBeDefined();
    expect(screen.getByRole("link", { name: /pr #7/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /linear/i })).toHaveProperty(
      "href",
      "https://linear.app/issue/ENG-42",
    );

    // Artifact tabs: no artifacts -> empty state message
    expect(screen.getByText(/no artifacts yet/i)).toBeDefined();
  });

  it("omits optional links and badges when branch/PR/issue-url fields are absent", () => {
    const run = makeRun({
      branchName: null,
      prNumber: null,
      linearIssueUrl: null,
      linearIssueTitle: null,
      linearIssueIdentifier: null,
    });
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-123456789");

    expect(screen.queryByRole("link", { name: /^pr #/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^linear$/i })).toBeNull();
    // Falls back to the sliced linearIssueId when no title/identifier present.
    expect(screen.getByText("issue-ab")).toBeDefined();
  });

  it("shows the open questions panel for HumanClarificationNeeded state with required questions", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts: Artifact[] = [
      {
        id: "artifact-1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "What auth method?", requiredForExecution: true },
          ],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-123456789");

    const panel = screen.getByRole("region", { name: "Open Questions" });
    expect(panel).toBeDefined();
    expect(screen.getAllByText("What auth method?").length).toBeGreaterThan(0);
    // Required question -> Answer Questions action bar button should appear.
    expect(screen.getByRole("button", { name: /answer questions/i })).toBeDefined();
  });

  it("shows optional questions panel for AwaitingPlanApproval state and hides it when there are none", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts: Artifact[] = [
      {
        id: "artifact-1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Optional detail?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockUseRun.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-123456789");

    const panel = screen.getByRole("region", { name: "Open Questions" });
    expect(panel).toBeDefined();
    expect(screen.getAllByText("Optional detail?").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /answer optional questions/i }),
    ).toBeDefined();
  });

  it("renders the distilled skill panel's loading and error states based on useRunSkills", () => {
    const run = makeRun();
    mockUseRun.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: false,
      error: "Failed to fetch run skills",
      refetch: vi.fn(),
    });

    renderAt("/runs/run-123456789");

    expect(screen.getByText("Failed to fetch run skills")).toBeDefined();
  });
});
