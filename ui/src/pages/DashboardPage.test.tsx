import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: { id: string; state: string }[]; onAction: () => void }) => (
    <div data-testid="runs-table" data-run-ids={runs.map((r) => r.id).join(",")}>
      <button onClick={onAction}>trigger-action</button>
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
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) =>
    open ? (
      <div data-testid="linear-sync-dialog">
        <button onClick={onClose}>close-dialog</button>
        <button onClick={() => onIngestComplete({ started: 3, skipped: 1 })}>
          complete-ingest
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
      {started} started, {skipped} skipped
      <button onClick={onDismiss}>dismiss</button>
    </div>
  ),
}));

import { useRuns } from "@/hooks/useRuns.ts";
import { DashboardPage } from "./DashboardPage.tsx";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<{ id: string; state: string }> = {}) {
  return {
    id: "run-1",
    repo: "org/repo",
    state: "Planning",
    linearIssueId: "issue-1",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the loading indicator and no table while loading", () => {
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

  it("shows the error message and no table when there is an error", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
    expect(screen.queryByText(/loading runs/i)).toBeNull();
  });

  it("renders the RunsTable with all runs when not loading and no error", () => {
    const runs = [makeRun({ id: "run-1" }), makeRun({ id: "run-2", state: "Done" })];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    const table = screen.getByTestId("runs-table");
    expect(table.getAttribute("data-run-ids")).toBe("run-1,run-2");
  });

  it("computes and displays per-category counts in the stats bar", () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Implementing" }), // active
      makeRun({ id: "r3", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r4", state: "AIBlocked" }), // blocked
      makeRun({ id: "r5", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    const totalLabel = screen.getByText("Total");
    expect(totalLabel.previousElementSibling?.textContent).toBe("5");

    const activeLabel = screen.getByText("Active", { selector: "div" });
    expect(activeLabel.previousElementSibling?.textContent).toBe("2");

    const awaitingLabel = screen.getByText("Awaiting");
    expect(awaitingLabel.previousElementSibling?.textContent).toBe("1");

    const blockedLabel = screen.getByText("Blocked", { selector: "div" });
    expect(blockedLabel.previousElementSibling?.textContent).toBe("1");

    const doneLabel = screen.getByText("Done", { selector: "div" });
    expect(doneLabel.previousElementSibling?.textContent).toBe("1");
  });

  it("filters runs by category when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", state: "Planning" }), // active
      makeRun({ id: "r2", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table").getAttribute("data-run-ids")).toBe("r1,r2");

    await userEvent.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.getByTestId("runs-table").getAttribute("data-run-ids")).toBe("r1");
  });

  it("returns to showing all runs when the All filter is re-selected", async () => {
    const runs = [makeRun({ id: "r1", state: "Planning" }), makeRun({ id: "r2", state: "Done" })];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table").getAttribute("data-run-ids")).toBe("r2");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table").getAttribute("data-run-ids")).toBe("r1,r2");
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked, closed by default", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));

    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();
  });

  it("closes the dialog via onClose", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("close-dialog"));

    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
  });

  it("shows the ingest summary banner after onIngestComplete fires, and dismisses it", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();

    await userEvent.click(screen.getByText("complete-ingest"));

    const banner = screen.getByTestId("ingest-summary-banner");
    expect(banner.textContent).toContain("3 started");
    expect(banner.textContent).toContain("1 skipped");

    await userEvent.click(screen.getByText("dismiss"));
    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  it("calls refetch when the RunsTable triggers onAction", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });

    render(<DashboardPage />);
    await userEvent.click(screen.getByText("trigger-action"));

    expect(refetch).toHaveBeenCalledOnce();
  });
});
