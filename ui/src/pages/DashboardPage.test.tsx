import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage.tsx";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: (props: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{props.runs.length}</span>
      {props.runs.map((r) => (
        <span key={r.id} data-testid="run-row">
          {r.id}
        </span>
      ))}
      <button data-testid="runs-table-action" onClick={props.onAction}>
        trigger action
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
  }) =>
    props.open ? (
      <div data-testid="sync-dialog">
        <button data-testid="close-dialog" onClick={props.onClose}>
          close
        </button>
        <button data-testid="trigger-ingested" onClick={props.onIngested}>
          ingested
        </button>
        <button
          data-testid="trigger-complete"
          onClick={() => props.onIngestComplete?.({ started: 2, skipped: 1 })}
        >
          complete
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: (props: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => (
    <div data-testid="ingest-banner">
      <span data-testid="banner-text">
        {props.started}/{props.skipped}
      </span>
      <button data-testid="dismiss-banner" onClick={props.onDismiss}>
        dismiss
      </button>
    </div>
  ),
}));

import { useRuns } from "@/hooks/useRuns.ts";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

const makeRun = (id: string, state: string): Run => ({
  id,
  linearIssueId: "li-1",
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
  workingDirectory: "/tmp",
  latestArtifactVersion: 0,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
});

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

function statsBar(): HTMLElement {
  return screen.getByText("Total").closest(".grid") as HTMLElement;
}

describe("DashboardPage", () => {
  const refetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch });
    renderPage();
    expect(screen.getByText("Loading runs...")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when the runs fetch fails", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch,
    });
    renderPage();
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the runs table with all runs when loaded with no error", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun("r1", "Todo"), makeRun("r2", "Done")],
      loading: false,
      error: null,
      refetch,
    });
    renderPage();
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("computes and displays the stats bar counts per category", () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun("r1", "Planning"), // active
        makeRun("r2", "AwaitingPlanApproval"), // waiting
        makeRun("r3", "AIBlocked"), // blocked
        makeRun("r4", "Done"), // done
      ],
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    const stats = statsBar();
    expect(within(stats).getByText("Total").previousSibling?.textContent).toBe("4");
    expect(within(stats).getByText("Active").previousSibling?.textContent).toBe("1");
    expect(within(stats).getByText("Awaiting").previousSibling?.textContent).toBe("1");
    expect(within(stats).getByText("Blocked").previousSibling?.textContent).toBe("1");
    expect(within(stats).getByText("Done").previousSibling?.textContent).toBe("1");
  });

  it("treats a state with no category mapping as idle in the stats (not counted elsewhere)", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun("r1", "SomeUnknownState")],
      loading: false,
      error: null,
      refetch,
    });
    renderPage();
    const stats = statsBar();
    expect(within(stats).getByText("Active").previousSibling?.textContent).toBe("0");
    expect(within(stats).getByText("Done").previousSibling?.textContent).toBe("0");
  });

  it("filters the runs table when a filter button is clicked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun("r1", "Planning"), makeRun("r2", "Done")],
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");
    expect(screen.getByText("r2")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("passes refetch as the onAction handler to the runs table", async () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun("r1", "Todo")],
      loading: false,
      error: null,
      refetch,
    });
    renderPage();

    await userEvent.click(screen.getByTestId("runs-table-action"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked, and closes it", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByTestId("close-dialog"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("calls refetch when the sync dialog reports onIngested", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByTestId("trigger-ingested"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner after onIngestComplete fires, and lets it be dismissed", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByTestId("trigger-complete"));

    expect(screen.getByTestId("banner-text").textContent).toBe("2/1");

    await userEvent.click(screen.getByTestId("dismiss-banner"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout elapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByTestId("trigger-complete"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
