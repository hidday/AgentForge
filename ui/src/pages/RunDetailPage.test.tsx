import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RunDetailPage } from "./RunDetailPage.tsx";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));

import { useRun } from "@/hooks/useRun.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;

const baseRun: Run = {
  id: "run-123456789",
  linearIssueId: "li-1",
  linearIssueIdentifier: "ENG-1",
  linearIssueDescription: null,
  linearIssueTitle: "Fix the thing",
  linearIssueUrl: "https://linear.app/issue/ENG-1",
  repo: "org/repo",
  branchName: "feature/fix",
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
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

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

  it("shows a loading indicator while the run is loading", () => {
    mockUseRun.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderAt("/runs/run-123456789");
    expect(screen.getByText("Loading run...")).toBeDefined();
  });

  it("shows an error message when the run fetch fails", () => {
    mockUseRun.mockReturnValue({
      data: null,
      loading: false,
      error: "boom",
      refetch: vi.fn(),
    });
    renderAt("/runs/run-123456789");
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows a 'Run not found' message when there is no error but also no data", () => {
    mockUseRun.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderAt("/runs/run-123456789");
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details once loaded", () => {
    mockUseRun.mockReturnValue({
      data: { run: baseRun, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("/runs/run-123456789");

    expect(screen.getByText("run-1234")).toBeDefined();
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("feature/fix")).toBeDefined();
    expect(screen.getByText("PR #42")).toBeDefined();
    expect(screen.getByRole("link", { name: /linear/i })).toHaveProperty(
      "href",
      "https://linear.app/issue/ENG-1",
    );
  });

  it("falls back to the linear issue identifier, then id, when there is no title", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: { ...baseRun, linearIssueTitle: null },
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("/runs/run-123456789");
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated issue id when there is neither a title nor an identifier", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: {
          ...baseRun,
          linearIssueTitle: null,
          linearIssueIdentifier: null,
          linearIssueId: "abcdefghijklmnop",
        },
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("/runs/run-123456789");
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("does not render the PR / branch / Linear links when those fields are absent", () => {
    mockUseRun.mockReturnValue({
      data: {
        run: {
          ...baseRun,
          branchName: null,
          prNumber: null,
          linearIssueUrl: null,
          workingDirectory: "",
        },
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("/runs/run-123456789");
    expect(screen.queryByText(/PR #/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^linear$/i })).toBeNull();
  });

  it("extracts open questions from the latest Plan artifact and shows the questions panel in HumanClarificationNeeded", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: baseRun.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Which env?", requiredForExecution: true },
          { id: "q2", question: "Any perf concerns?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: {
        run: { ...baseRun, state: "HumanClarificationNeeded" },
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("/runs/run-123456789");

    const panel = screen.getByRole("region", { name: "Open Questions" });
    expect(within(panel).getByText("Which env?")).toBeDefined();
    expect(within(panel).getByText("Any perf concerns?")).toBeDefined();
  });

  it("shows only optional questions in the AwaitingPlanApproval secondary panel", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: baseRun.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required one", requiredForExecution: true },
          { id: "q2", question: "Optional one", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    mockUseRun.mockReturnValue({
      data: {
        run: { ...baseRun, state: "AwaitingPlanApproval" },
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("/runs/run-123456789");

    const panel = screen.getByRole("region", { name: "Open Questions" });
    expect(within(panel).queryByText("Required one")).toBeNull();
    expect(within(panel).getByText("Optional one")).toBeDefined();
  });

  it("renders an empty events list and no plan artifact gracefully", () => {
    mockUseRun.mockReturnValue({
      data: { run: baseRun, artifacts: [], events: [] satisfies RunEventRecord[] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("/runs/run-123456789");
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(
      screen.getByText("No artifacts yet — the run hasn't produced any output."),
    ).toBeDefined();
  });

  it("passes active-process data from useActiveProcesses through to the agent output panel", () => {
    mockUseRun.mockReturnValue({
      data: { run: { ...baseRun, state: "Implementing" }, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseActiveProcesses.mockReturnValue({
      processes: [
        {
          id: "p1",
          pid: 1,
          command: "run",
          runId: baseRun.id,
          stage: "Implementing",
          runtime: "claude",
          startedAt: "2024-01-01T00:00:00Z",
          elapsedMs: 0,
        },
      ],
      hasActive: true,
      output: "some output",
      activeProcessId: "p1",
    });
    renderAt("/runs/run-123456789");
    expect(screen.getByText("some output")).toBeDefined();
  });

  it("scrolls to the questions panel when the action bar's 'Answer Questions' button is clicked", async () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: baseRun.id,
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
        run: { ...baseRun, state: "HumanClarificationNeeded" },
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("/runs/run-123456789");

    const scrollSpy = vi.fn();
    const panel = screen.getByRole("region", { name: "Open Questions" });
    // The scrollable ref is on the wrapping <div>, not the <section> itself.
    (panel.parentElement as HTMLElement).scrollIntoView = scrollSpy;

    await userEvent.click(screen.getByRole("button", { name: /answer questions/i }));
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("surfaces the distilled-skill hook's loading state via the DistilledSkillPanel", () => {
    mockUseRun.mockReturnValue({
      data: { run: baseRun, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRunSkills.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    renderAt("/runs/run-123456789");
    expect(screen.getByText("Loading distilled skill...")).toBeDefined();
  });
});
