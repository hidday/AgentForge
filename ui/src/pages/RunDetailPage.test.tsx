import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RunDetailPage } from "./RunDetailPage.tsx";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn().mockResolvedValue({ ok: true, state: "Done" }),
    rejectPlan: vi.fn().mockResolvedValue({ ok: true, state: "Done" }),
    reReviewPlan: vi.fn().mockResolvedValue({ ok: true, runId: "r" }),
    revisePlan: vi.fn().mockResolvedValue({ ok: true, runId: "r" }),
    approveReview: vi.fn().mockResolvedValue({ ok: true, state: "Done" }),
    pauseRun: vi.fn().mockResolvedValue({ ok: true }),
    resumeRun: vi.fn().mockResolvedValue({ ok: true }),
    retryStage: vi.fn().mockResolvedValue({ ok: true, state: "Done", retrying: true }),
    answerQuestions: vi.fn().mockResolvedValue({ ok: true, run: {} }),
    sendChatMessage: vi.fn().mockResolvedValue({ reply: "", durationMs: 0 }),
  },
}));

let mockUseRun: { data: unknown; loading: boolean; error: string | null; refetch: ReturnType<typeof vi.fn> };
vi.mock("@/hooks/useRun.ts", () => ({
  useRun: () => mockUseRun,
}));

vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: () => ({ data: null, loading: false, error: null, refetch: vi.fn() }),
}));

vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: () => ({
    processes: [],
    hasActive: false,
    output: "",
    activeProcessId: null,
  }),
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-abcdef1234567890",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Done",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-abcdef1234567890"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun = { data: null, loading: true, error: null, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("shows the error message when the fetch failed", () => {
    mockUseRun = { data: null, loading: false, error: "Network error", refetch: vi.fn() };
    renderPage();
    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("falls back to 'Run not found' when there is no error but also no data", () => {
    mockUseRun = { data: null, loading: false, error: null, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText(/run not found/i)).toBeDefined();
  });

  it("renders run header details: id prefix, issue title, repo, and state badge", () => {
    const run = makeRun();
    mockUseRun = {
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    renderPage();

    expect(screen.getByText("run-abcd")).toBeDefined();
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("Done", { selector: "span" })).toBeDefined();
  });

  it("shows the Linear link only when linearIssueUrl is set", () => {
    const withUrl = makeRun({ linearIssueUrl: "https://linear.app/issue/ENG-1" });
    mockUseRun = {
      data: { run: withUrl, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    const { rerender } = renderPage();
    expect(screen.getByRole("link", { name: /linear/i })).toBeDefined();

    const withoutUrl = makeRun({ linearIssueUrl: null });
    mockUseRun = {
      data: { run: withoutUrl, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    rerender(
      <MemoryRouter initialEntries={["/runs/run-abcdef1234567890"]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: /linear/i })).toBeNull();
  });

  it("shows branch, PR, Cursor and Claude links only when branchName and workingDirectory are both set", () => {
    const run = makeRun({
      branchName: "feature/x",
      workingDirectory: "/work/run-1",
      prNumber: 42,
    });
    mockUseRun = {
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    renderPage();

    expect(screen.getByText("feature/x")).toBeDefined();
    expect(screen.getByRole("link", { name: /pr #42/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /cursor/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /claude$/i })).toBeDefined();
  });

  it("omits branch-dependent links when branchName is absent", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    mockUseRun = {
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    renderPage();

    expect(screen.queryByRole("link", { name: /cursor/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /pr #/i })).toBeNull();
  });

  it("shows the OpenQuestionsPanel with all open questions in HumanClarificationNeeded state", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts: Artifact[] = [
      {
        id: "art-1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
            { id: "q2", question: "Any perf concerns?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: run.createdAt,
      },
    ];
    mockUseRun = {
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    renderPage();

    // Both required and optional questions show up in the HumanClarificationNeeded panel
    const panel = screen.getByRole("region", { name: "Open Questions" });
    expect(within(panel).getByText("Which env?")).toBeDefined();
    expect(within(panel).getByText("Any perf concerns?")).toBeDefined();
    // ActionBar shows the "Answer Questions" shortcut for this state
    expect(screen.getByRole("button", { name: "Answer Questions" })).toBeDefined();
  });

  it("shows only optional questions in a secondary panel for AwaitingPlanApproval, and the optional-questions action", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts: Artifact[] = [
      {
        id: "art-1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Required one", requiredForExecution: true },
            { id: "q2", question: "Optional one", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: run.createdAt,
      },
    ];
    mockUseRun = {
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    renderPage();

    // Only the optional question renders in AwaitingPlanApproval's secondary panel
    const panel = screen.getByRole("region", { name: "Open Questions" });
    expect(within(panel).getByText("Optional one")).toBeDefined();
    expect(within(panel).queryByText("Required one")).toBeNull();
    expect(
      screen.getByRole("button", { name: /answer optional questions/i }),
    ).toBeDefined();
  });

  it("does not render any OpenQuestionsPanel when there are no open questions", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    mockUseRun = {
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    renderPage();

    expect(
      screen.queryByRole("button", { name: /answer optional questions/i }),
    ).toBeNull();
    expect(screen.queryByRole("region", { name: "Open Questions" })).toBeNull();
  });

  it("renders the event timeline and artifact tabs wired from fetched data", () => {
    const run = makeRun({ state: "Done" });
    const events: RunEventRecord[] = [
      {
        id: "ev-1",
        runId: run.id,
        eventType: "run:state-changed",
        source: "system",
        payloadJson: {},
        createdAt: run.createdAt,
      },
    ];
    mockUseRun = {
      data: { run, artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    renderPage();

    // No artifacts -> ArtifactTabs empty state
    expect(screen.getByText(/no artifacts yet/i)).toBeDefined();
  });
});
