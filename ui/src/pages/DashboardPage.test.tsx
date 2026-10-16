import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: vi.fn((props: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table" data-count={props.runs.length}>
      {props.runs.map((r) => (
        <span key={r.id}>{r.id}</span>
      ))}
      <button onClick={() => props.onAction?.()}>trigger-runs-table-action</button>
    </div>
  )),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: vi.fn(
    (props: {
      open: boolean;
      onClose: () => void;
      onIngested: () => void;
      onIngestComplete: (s: { started: number; skipped: number }) => void;
    }) => (
      <div data-testid="linear-sync-dialog" data-open={String(props.open)}>
        <button onClick={() => props.onClose()}>trigger-close</button>
        <button onClick={() => props.onIngested()}>trigger-ingested</button>
        <button onClick={() => props.onIngestComplete({ started: 3, skipped: 1 })}>
          trigger-ingest-complete
        </button>
      </div>
    ),
  ),
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: vi.fn(
    (props: { started: number; skipped: number; onDismiss: () => void }) => (
      <div data-testid="ingest-summary-banner">
        started:{props.started} skipped:{props.skipped}
        <button onClick={() => props.onDismiss()}>trigger-dismiss</button>
      </div>
    ),
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";
import { useRuns } from "@/hooks/useRuns.ts";
import { RunsTable } from "@/components/RunsTable.tsx";
import { LinearSyncDialog } from "@/components/LinearSyncDialog.tsx";
import { IngestSummaryBanner } from "@/components/IngestSummaryBanner.tsx";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;
const mockRunsTable = RunsTable as unknown as ReturnType<typeof vi.fn>;
const mockLinearSyncDialog = LinearSyncDialog as unknown as ReturnType<typeof vi.fn>;
const mockIngestSummaryBanner = IngestSummaryBanner as unknown as ReturnType<
  typeof vi.fn
>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some issue",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
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

function lastRunsTableProps() {
  const calls = mockRunsTable.mock.calls;
  return calls[calls.length - 1]![0] as { runs: Run[]; onAction?: () => void };
}

function lastLinearSyncDialogProps() {
  const calls = mockLinearSyncDialog.mock.calls;
  return calls[calls.length - 1]![0] as {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  };
}

function getStatValue(label: string): string {
  // Some labels ("Blocked", "Done") also appear as filter button text, so
  // disambiguate by matching the stat box's label element specifically.
  const candidates = screen.getAllByText(label);
  const statLabel = candidates.find((el) =>
    el.className.includes("text-xs text-text-muted mt-0.5"),
  );
  if (!statLabel) throw new Error(`stat label not found for "${label}"`);
  return statLabel.previousElementSibling?.textContent ?? "";
}

const defaultHookResult = {
  runs: [] as Run[],
  loading: false,
  error: null as string | null,
  refetch: vi.fn(),
};

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRuns.mockReturnValue({ ...defaultHookResult, refetch: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the loading indicator while the hook reports loading, without rendering RunsTable", () => {
    mockUseRuns.mockReturnValue({ ...defaultHookResult, loading: true });
    render(<DashboardPage />);

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows the error message when the hook reports an error, without rendering RunsTable", () => {
    mockUseRuns.mockReturnValue({
      ...defaultHookResult,
      loading: false,
      error: "Network failure",
    });
    render(<DashboardPage />);

    expect(screen.getByText("Network failure")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders RunsTable with all runs and correct stat counts when populated", () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing" }), // active
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "AIBlocked" }), // blocked
      makeRun({ id: "r4", state: "Done" }), // done
      makeRun({ id: "r5", state: "Todo" }), // idle
    ];
    mockUseRuns.mockReturnValue({ ...defaultHookResult, runs });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table")).toBeDefined();
    expect(lastRunsTableProps().runs).toEqual(runs);

    expect(getStatValue("Total")).toBe("5");
    expect(getStatValue("Active")).toBe("1");
    expect(getStatValue("Awaiting")).toBe("1");
    expect(getStatValue("Blocked")).toBe("1");
    expect(getStatValue("Done")).toBe("1");
  });

  it("renders RunsTable with an empty list and zeroed stats when there are no runs", () => {
    mockUseRuns.mockReturnValue({ ...defaultHookResult, runs: [] });
    render(<DashboardPage />);

    expect(lastRunsTableProps().runs).toEqual([]);
    expect(getStatValue("Total")).toBe("0");
    expect(getStatValue("Active")).toBe("0");
    expect(getStatValue("Awaiting")).toBe("0");
    expect(getStatValue("Blocked")).toBe("0");
    expect(getStatValue("Done")).toBe("0");
  });

  it("filters the runs passed to RunsTable when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing" }), // active
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "AIBlocked" }), // blocked
    ];
    mockUseRuns.mockReturnValue({ ...defaultHookResult, runs });
    render(<DashboardPage />);

    expect(lastRunsTableProps().runs).toEqual(runs);

    const activeButton = screen.getByRole("button", { name: "Active" });
    await userEvent.click(activeButton);

    expect(lastRunsTableProps().runs).toEqual([runs[0]]);
    // Selected filter gets the active styling.
    expect(activeButton.className).toContain("bg-accent");

    const allButton = screen.getByRole("button", { name: "All" });
    await userEvent.click(allButton);
    expect(lastRunsTableProps().runs).toEqual(runs);
  });

  it("passes the hook's refetch as RunsTable's onAction", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ ...defaultHookResult, runs: [makeRun()], refetch });
    render(<DashboardPage />);

    expect(lastRunsTableProps().onAction).toBe(refetch);

    await userEvent.click(
      screen.getByRole("button", { name: "trigger-runs-table-action" }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked, and closes it via onClose", async () => {
    mockUseRuns.mockReturnValue({ ...defaultHookResult, runs: [] });
    render(<DashboardPage />);

    expect(lastLinearSyncDialogProps().open).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(lastLinearSyncDialogProps().open).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "trigger-close" }));
    expect(lastLinearSyncDialogProps().open).toBe(false);
  });

  it("wires LinearSyncDialog's onIngested to the hook's refetch", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ ...defaultHookResult, runs: [], refetch });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "trigger-ingested" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("does not render the ingest summary banner until onIngestComplete fires", () => {
    mockUseRuns.mockReturnValue({ ...defaultHookResult, runs: [] });
    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  it("shows the IngestSummaryBanner with the reported counts after onIngestComplete fires", async () => {
    mockUseRuns.mockReturnValue({ ...defaultHookResult, runs: [] });
    render(<DashboardPage />);

    await userEvent.click(
      screen.getByRole("button", { name: "trigger-ingest-complete" }),
    );

    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();
    expect(mockIngestSummaryBanner).toHaveBeenCalledWith(
      expect.objectContaining({ started: 3, skipped: 1 }),
      undefined,
    );
  });

  it("dismisses the ingest summary banner when its onDismiss is invoked", async () => {
    mockUseRuns.mockReturnValue({ ...defaultHookResult, runs: [] });
    render(<DashboardPage />);

    await userEvent.click(
      screen.getByRole("button", { name: "trigger-ingest-complete" }),
    );
    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "trigger-dismiss" }));
    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the auto-dismiss timeout", () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({ ...defaultHookResult, runs: [] });
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "trigger-ingest-complete" }));
    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });
});
