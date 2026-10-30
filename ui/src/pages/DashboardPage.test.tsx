import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: (props: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table" data-run-count={props.runs.length}>
      <button data-testid="runs-table-action" onClick={() => props.onAction?.()}>
        action
      </button>
    </div>
  ),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) => (
    <div data-testid="sync-dialog" data-open={props.open}>
      <button data-testid="sync-close" onClick={props.onClose}>
        close
      </button>
      <button data-testid="sync-ingested" onClick={props.onIngested}>
        ingested
      </button>
      <button
        data-testid="sync-complete"
        onClick={() => props.onIngestComplete?.({ started: 2, skipped: 1 })}
      >
        complete
      </button>
    </div>
  ),
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: (props: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => (
    <div data-testid="ingest-banner">
      Started {props.started}, skipped {props.skipped}
      <button data-testid="banner-dismiss" onClick={props.onDismiss}>
        dismiss
      </button>
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

const refetch = vi.fn();

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch });
    render(<DashboardPage />);
    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows error message when the fetch fails", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Network error",
      refetch,
    });
    render(<DashboardPage />);
    expect(screen.getByText("Network error")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders RunsTable with all runs and zeroed stats when there are none", () => {
    render(<DashboardPage />);
    const table = screen.getByTestId("runs-table");
    expect(table.getAttribute("data-run-count")).toBe("0");
    expect(screen.getByText("Total").previousSibling?.textContent).toBe("0");
  });

  it("computes stat counts per category from run states", () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun("1", "Implementing"), // active
        makeRun("2", "AwaitingPlanApproval"), // waiting
        makeRun("3", "AIBlocked"), // blocked
        makeRun("4", "Done"), // done
        makeRun("5", "Implementing"), // active
      ],
      loading: false,
      error: null,
      refetch,
    });
    render(<DashboardPage />);

    expect(screen.getByText("Total").previousSibling?.textContent).toBe("5");
    expect(
      screen.getAllByText("Active", { selector: "div" })[0]?.previousSibling?.textContent,
    ).toBe("2");
    expect(screen.getByText("Awaiting").previousSibling?.textContent).toBe("1");
    expect(
      screen.getByText("Blocked", { selector: "div" }).previousSibling?.textContent,
    ).toBe("1");
    expect(screen.getByText("Done", { selector: "div" }).previousSibling?.textContent).toBe("1");
  });

  it("falls back to idle category for unmapped states and does not crash stat counting", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun("1", "SomeUnknownState")],
      loading: false,
      error: null,
      refetch,
    });
    render(<DashboardPage />);
    expect(screen.getByText("Total").previousSibling?.textContent).toBe("1");
    expect(
      screen.getAllByText("Active", { selector: "div" })[0]?.previousSibling?.textContent,
    ).toBe("0");
  });

  it("filters runs by category when a filter button is clicked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun("1", "Implementing"), // active
        makeRun("2", "Done"), // done
      ],
      loading: false,
      error: null,
      refetch,
    });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table").getAttribute("data-run-count")).toBe("2");

    await userEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("runs-table").getAttribute("data-run-count")).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table").getAttribute("data-run-count")).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table").getAttribute("data-run-count")).toBe("2");
  });

  it("highlights the active filter button", async () => {
    render(<DashboardPage />);
    const allBtn = screen.getByRole("button", { name: "All" });
    const activeBtn = screen.getByRole("button", { name: "Active" });
    expect(allBtn.className).toContain("bg-accent");
    expect(activeBtn.className).not.toContain("bg-accent");

    await userEvent.click(activeBtn);
    expect(activeBtn.className).toContain("bg-accent");
    expect(allBtn.className).not.toContain("bg-accent");
  });

  it("RunsTable onAction triggers refetch from useRuns", async () => {
    render(<DashboardPage />);
    await userEvent.click(screen.getByTestId("runs-table-action"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked, and closes it", async () => {
    render(<DashboardPage />);
    expect(screen.getByTestId("sync-dialog").getAttribute("data-open")).toBe("false");

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog").getAttribute("data-open")).toBe("true");

    await userEvent.click(screen.getByTestId("sync-close"));
    expect(screen.getByTestId("sync-dialog").getAttribute("data-open")).toBe("false");
  });

  it("LinearSyncDialog onIngested triggers refetch", async () => {
    render(<DashboardPage />);
    await userEvent.click(screen.getByTestId("sync-ingested"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the ingest summary banner after onIngestComplete and auto-dismisses it", () => {
    vi.useFakeTimers();
    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId("sync-complete"));
    });
    expect(screen.getByTestId("ingest-banner")).toBeDefined();
    expect(screen.getByText(/started 2, skipped 1/i)).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("dismisses the ingest summary banner manually via onDismiss", async () => {
    render(<DashboardPage />);
    await userEvent.click(screen.getByTestId("sync-complete"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    await userEvent.click(screen.getByTestId("banner-dismiss"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
