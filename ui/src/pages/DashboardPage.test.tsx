import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs }: { runs: Run[] }) => (
    <div data-testid="runs-table">
      {runs.map((r) => (
        <div key={r.id} data-testid="run-row">
          {r.id}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onClose,
    onIngestComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) => (
    <div data-testid="linear-sync-dialog" data-open={open ? "true" : "false"}>
      {open && (
        <>
          <button
            onClick={() => onIngestComplete?.({ started: 3, skipped: 1 })}
          >
            Simulate Ingest Complete
          </button>
          <button onClick={onClose}>Close Dialog</button>
        </>
      )}
    </div>
  ),
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
      Started {started}, skipped {skipped}
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(id: string, state: string): Run {
  return {
    id,
    linearIssueId: `issue-${id}`,
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state,
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
  };
}

const MIXED_RUNS: Run[] = [
  makeRun("r-active-1", "Implementing"),
  makeRun("r-active-2", "Planning"),
  makeRun("r-waiting-1", "AwaitingPlanApproval"),
  makeRun("r-blocked-1", "AIBlocked"),
  makeRun("r-done-1", "Done"),
];

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
    useRunsMock.mockReturnValue({
      runs: MIXED_RUNS,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading spinner while loading is true", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error banner when error is set", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("computes stat counts correctly per state category from a mixed runs array", () => {
    renderPage();
    // Total
    expect(screen.getByText("5")).toBeDefined();
    // Active: Implementing + Planning = 2
    // Awaiting: AwaitingPlanApproval = 1
    // Blocked: AIBlocked = 1
    // Done: Done = 1
    const twos = screen.getAllByText("2");
    expect(twos.length).toBeGreaterThanOrEqual(1);
    const ones = screen.getAllByText("1");
    // waiting, blocked, done each contribute a "1"
    expect(ones.length).toBeGreaterThanOrEqual(3);
  });

  it("falls back to the 'idle' category count for a run with an unrecognized state", () => {
    useRunsMock.mockReturnValue({
      runs: [makeRun("r-unknown-1", "SomeUnmappedState")],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    // Total is 1, and none of the known categories (active/waiting/blocked/done) count it
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getAllByText("0")).toHaveLength(4);
  });

  it("renders all runs by default (All filter)", () => {
    renderPage();
    expect(screen.getAllByTestId("run-row")).toHaveLength(5);
  });

  it("filters to Active runs when the Active filter button is clicked", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    const rows = screen.getAllByTestId("run-row");
    expect(rows.map((r) => r.textContent)).toEqual(["r-active-1", "r-active-2"]);
  });

  it("filters to Awaiting Human runs when that filter button is clicked", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Awaiting Human" }));
    const rows = screen.getAllByTestId("run-row");
    expect(rows.map((r) => r.textContent)).toEqual(["r-waiting-1"]);
  });

  it("filters to Blocked runs when that filter button is clicked", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Blocked" }));
    const rows = screen.getAllByTestId("run-row");
    expect(rows.map((r) => r.textContent)).toEqual(["r-blocked-1"]);
  });

  it("filters to Done runs when that filter button is clicked", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const rows = screen.getAllByTestId("run-row");
    expect(rows.map((r) => r.textContent)).toEqual(["r-done-1"]);
  });

  it("returns to All when the All filter button is clicked after another filter", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getAllByTestId("run-row")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByTestId("run-row")).toHaveLength(5);
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked", () => {
    renderPage();
    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("true");
  });

  it("closes the LinearSyncDialog when its onClose callback fires", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /close dialog/i }));
    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("false");
  });

  it("shows the IngestSummaryBanner after onIngestComplete fires and auto-dismisses after the timeout", () => {
    vi.useFakeTimers();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    fireEvent.click(screen.getByRole("button", { name: /simulate ingest complete/i }));

    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();
    expect(screen.getByText(/started 3, skipped 1/i)).toBeDefined();

    // Not yet dismissed before the timeout elapses
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.queryByTestId("ingest-summary-banner")).not.toBeNull();

    // Auto-dismisses once the configured timeout elapses
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  it("dismisses the IngestSummaryBanner via its own dismiss button before the auto-dismiss timeout", () => {
    vi.useFakeTimers();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    fireEvent.click(screen.getByRole("button", { name: /simulate ingest complete/i }));

    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });
});
