import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    fetchPendingIssues: vi.fn(),
    ingestIssues: vi.fn(),
  },
}));

vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

// The Linear sync dialog is a separately-tested, independent component; stub
// it so DashboardPage tests focus on filtering/stats/banner logic and can
// drive onIngestComplete directly without the real ingest flow.
vi.mock(
  "@/components/LinearSyncDialog.tsx",
  () => ({
    LinearSyncDialog: (props: {
      open: boolean;
      onClose: () => void;
      onIngested: () => void;
      onIngestComplete?: (s: { started: number; skipped: number }) => void;
    }) => (
      <div data-testid="sync-dialog-mock" data-open={String(props.open)}>
        {props.open && (
          <>
            <button onClick={props.onClose}>close-dialog</button>
            <button onClick={props.onIngested}>trigger-ingested</button>
            <button onClick={() => props.onIngestComplete?.({ started: 2, skipped: 1 })}>
              trigger-ingest-complete
            </button>
            <button onClick={() => props.onIngestComplete?.({ started: 1, skipped: 0 })}>
              trigger-ingest-complete-single
            </button>
          </>
        )}
      </div>
    ),
  }),
);

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-12345678",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
    expect(screen.queryByText(/No runs found/i)).toBeNull();
  });

  it("shows the error banner when the hook reports an error", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
  });

  it("shows the empty state when there are no runs", () => {
    renderPage();
    expect(screen.getByText(/No runs found/i)).toBeDefined();
    // Stats should all read 0.
    expect(screen.getByText("Total")).toBeDefined();
  });

  it("renders stats counts across different state categories", () => {
    const runs = [
      makeRun({ id: "r1", state: "Todo" }),
      makeRun({ id: "r2", state: "Implementing" }),
      makeRun({ id: "r3", state: "AwaitingPlanApproval" }),
      makeRun({ id: "r4", state: "AIBlocked" }),
      makeRun({ id: "r5", state: "Done" }),
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    const statValues = ["1", "1", "1", "1"]; // active, waiting, blocked, done each = 1
    for (const v of statValues) {
      expect(screen.getAllByText(v).length).toBeGreaterThan(0);
    }
    // Total = 5
    expect(screen.getByText("5")).toBeDefined();
  });

  it("accumulates the count for a state category shared by more than one run", () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing" }),
      makeRun({ id: "r2", state: "AIReview" }), // also "active" category
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    // Both runs fall into the "active" category, so its stat tile reads 2.
    const activeTile = container.querySelector(".text-state-active");
    expect(activeTile?.textContent).toBe("2");
  });

  it("falls back to the idle category in the stats bar for an unrecognized state value", () => {
    const runs = [makeRun({ id: "r1", state: "SomeUnknownState" })];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    // Unknown states aren't active/waiting/blocked/done, so all those tiles
    // stay at 0 while Total still counts the run.
    expect(screen.getByText("Total")).toBeDefined();
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBe(4); // Active, Awaiting, Blocked, Done
  });

  it("filters the runs table when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", state: "Todo", linearIssueTitle: "Todo run" }),
      makeRun({ id: "r2", state: "Implementing", linearIssueTitle: "Active run" }),
      makeRun({ id: "r3", state: "Done", linearIssueTitle: "Done run" }),
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText("Todo run")).toBeDefined();
    expect(screen.getByText("Active run")).toBeDefined();
    expect(screen.getByText("Done run")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.queryByText("Todo run")).toBeNull();
    expect(screen.getByText("Active run")).toBeDefined();
    expect(screen.queryByText("Done run")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Todo run")).toBeDefined();
    expect(screen.getByText("Done run")).toBeDefined();
  });

  it("opens and closes the Linear sync dialog", async () => {
    renderPage();
    expect(screen.getByTestId("sync-dialog-mock").dataset.open).toBe("false");

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog-mock").dataset.open).toBe("true");

    await userEvent.click(screen.getByText("close-dialog"));
    expect(screen.getByTestId("sync-dialog-mock").dataset.open).toBe("false");
  });

  it("refetches runs when the dialog reports ingested issues", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByText("trigger-ingested"));

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner after onIngestComplete and auto-dismisses it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByText("trigger-ingest-complete"));

    expect(screen.getByText("Started 2 runs")).toBeDefined();
    expect(screen.getByText(/skipped 1/i)).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(5100);
    });

    expect(screen.queryByText("Started 2 runs")).toBeNull();
    vi.useRealTimers();
  });

  it("dismisses the ingest summary banner manually", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByText("trigger-ingest-complete"));

    expect(screen.getByText("Started 2 runs")).toBeDefined();

    await userEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByText("Started 2 runs")).toBeNull();
  });

  it("singularizes the started label when exactly one run started and omits the skipped clause when zero", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByText("trigger-ingest-complete-single"));

    expect(screen.getByText("Started 1 run")).toBeDefined();
    expect(screen.queryByText(/skipped/i)).toBeNull();
  });
});
