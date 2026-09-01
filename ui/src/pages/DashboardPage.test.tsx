import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
      {runs.map((r) => (
        <span key={r.id} data-testid="run-row">
          {r.id}
        </span>
      ))}
      <button onClick={onAction}>trigger-action</button>
    </div>
  ),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) =>
    props.open ? (
      <div data-testid="linear-sync-dialog">
        <button onClick={props.onClose}>close-dialog</button>
        <button onClick={props.onIngested}>trigger-ingested</button>
        <button onClick={() => props.onIngestComplete({ started: 3, skipped: 1 })}>
          trigger-ingest-complete
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: ({
    started,
    skipped,
    onDismiss,
  }: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => (
    <div data-testid="ingest-summary-banner">
      started={started} skipped={skipped}
      <button onClick={onDismiss}>dismiss-banner</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
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
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByText("Loading runs...")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when the fetch fails", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the runs table and correct per-category stat counts", () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }), // active
        makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
        makeRun({ id: "r3", state: "AIBlocked" }), // blocked
        makeRun({ id: "r4", state: "Done" }), // done
        makeRun({ id: "r5", state: "Todo" }), // idle
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("5");
    expect(screen.getByText("5", { selector: ".text-text-primary" })).toBeDefined();
    // one run per category badge value
    const statValues = screen.getAllByText("1");
    expect(statValues.length).toBe(4); // active, waiting, blocked, done each = 1
  });

  it("counts a run with an unrecognized state under the idle fallback category without crashing", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun({ id: "r1", state: "SomeBrandNewState" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    // Total still reflects the run even though its state maps to no known category.
    expect(screen.getByTestId("runs-count").textContent).toBe("1");
    // None of the named category stat cards (Active/Awaiting/Blocked/Done) count it.
    expect(screen.queryAllByText("1", { selector: ".text-state-active" }).length).toBe(0);
  });

  it("filters the runs table when a filter button is clicked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "Done" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    await userEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");
    expect(screen.getByText("r1")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");
    expect(screen.getByText("r2")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("passes refetch as the RunsTable onAction callback", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [makeRun()], loading: false, error: null, refetch });
    render(<DashboardPage />);

    await userEvent.click(screen.getByText("trigger-action"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("opens the Linear sync dialog and closes it", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("close-dialog"));
    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
  });

  it("calls refetch when the dialog reports onIngested", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByText("trigger-ingested"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner after onIngestComplete and auto-dismisses it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByText("trigger-ingest-complete"));

    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();
    expect(screen.getByText(/started=3 skipped=1/)).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
    vi.useRealTimers();
  });

  it("dismisses the ingest summary banner when the dismiss button is clicked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByText("trigger-ingest-complete"));
    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    await userEvent.click(screen.getByText("dismiss-banner"));
    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
