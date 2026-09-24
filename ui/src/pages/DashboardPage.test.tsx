import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: vi.fn(({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
      {runs.map((r) => (
        <div key={r.id} data-testid="run-row">
          {r.linearIssueTitle}
        </div>
      ))}
      <button onClick={onAction}>table-action</button>
    </div>
  )),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: vi.fn(
    ({
      open,
      onClose,
      onIngested,
      onIngestComplete,
    }: {
      open: boolean;
      onClose: () => void;
      onIngested: () => void;
      onIngestComplete?: (s: { started: number; skipped: number }) => void;
    }) =>
      open ? (
        <div data-testid="sync-dialog">
          <button onClick={onClose}>close-dialog</button>
          <button onClick={onIngested}>trigger-ingested</button>
          <button onClick={() => onIngestComplete?.({ started: 2, skipped: 1 })}>
            trigger-complete
          </button>
        </div>
      ) : null,
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";
import { useRuns } from "@/hooks/useRuns.ts";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the loading state while runs are being fetched", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows the error state when the hook surfaces an error", () => {
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

  it("renders the empty state (RunsTable with zero runs) when there are no runs", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table")).toBeDefined();
    expect(screen.getByTestId("runs-count").textContent).toBe("0");
  });

  it("renders populated runs with specific run data visible and correct stat counts", () => {
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: "Add feature X", state: "Implementing" }), // active
      makeRun({ id: "r2", linearIssueTitle: "Awaiting approval", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", linearIssueTitle: "Blocked run", state: "AIBlocked" }), // blocked
      makeRun({ id: "r4", linearIssueTitle: "Completed run", state: "Done" }), // done
      makeRun({ id: "r5", linearIssueTitle: "Unknown state run", state: "SomethingUnmapped" }), // falls back to "idle"
    ];
    mockUseRuns.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { container } = render(<DashboardPage />);

    expect(screen.getByText("Add feature X")).toBeDefined();
    expect(screen.getByText("Awaiting approval")).toBeDefined();
    expect(screen.getByText("Blocked run")).toBeDefined();
    expect(screen.getByText("Completed run")).toBeDefined();
    expect(screen.getByText("Unknown state run")).toBeDefined();
    expect(screen.getByTestId("runs-count").textContent).toBe("5");

    // Stat bar values, in order: Total / Active / Awaiting / Blocked / Done
    // (the unmapped-state run falls back to "idle" and isn't counted in any
    // of the four named buckets, only in Total)
    const statValues = Array.from(
      container.querySelectorAll(".text-2xl.font-semibold.tabular-nums"),
    ).map((el) => el.textContent);
    expect(statValues).toEqual(["5", "1", "1", "1", "1"]);
  });

  it("filters runs by category when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: "Active run", state: "Implementing" }),
      makeRun({ id: "r2", linearIssueTitle: "Done run", state: "Done" }),
    ];
    mockUseRuns.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    // Initially "all" filter shows both
    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByTestId("runs-count").textContent).toBe("1");
    expect(screen.getByText("Done run")).toBeDefined();
    expect(screen.queryByText("Active run")).toBeNull();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));

    expect(screen.getByTestId("sync-dialog")).toBeDefined();
  });

  it("closes the sync dialog when onClose is invoked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "close-dialog" }));

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("closes the sync dialog and calls refetch when the dialog reports ingestion", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch,
    });

    render(<DashboardPage />);
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByRole("button", { name: "trigger-ingested" }));

    expect(refetch).toHaveBeenCalled();
  });

  it("shows an ingest summary banner after onIngestComplete and dismisses it manually", async () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByRole("button", { name: "trigger-complete" }));

    expect(screen.getByText(/started 2 runs/i)).toBeDefined();
    expect(screen.getByText(/skipped 1/i)).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByText(/started 2 runs/i)).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout", () => {
    vi.useFakeTimers();

    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    fireEvent.click(screen.getByRole("button", { name: "trigger-complete" }));

    expect(screen.getByText(/started 2 runs/i)).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText(/started 2 runs/i)).toBeNull();
  });
});
