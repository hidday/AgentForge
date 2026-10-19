import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs }: { runs: Run[] }) => (
    <div data-testid="runs-table">{runs.map((r) => r.id).join(",")}</div>
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
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) =>
    open ? (
      <div data-testid="sync-dialog">
        <button onClick={onClose}>close-dialog</button>
        <button onClick={() => onIngestComplete?.({ started: 2, skipped: 1 })}>
          simulate-ingest
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
    <div data-testid="ingest-banner">
      started={started} skipped={skipped}
      <button onClick={onDismiss}>dismiss-banner</button>
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
    repo: "acme/widgets",
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
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    render(<DashboardPage />);
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
  });

  it("shows an error message when the runs fetch fails", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
  });

  it("renders stat counts derived from the runs list", () => {
    const runs = [
      makeRun("r1", "Implementing"), // active
      makeRun("r2", "AwaitingPlanApproval"), // waiting
      makeRun("r3", "AIBlocked"), // blocked
      makeRun("r4", "Done"), // done
      makeRun("r5", "SomeUnmappedState"), // falls back to "idle"
      makeRun("r6", "AIReview"), // active, second active run exercises the running-tally branch
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByText("Agent Runs")).toBeDefined();
    const total = screen.getByText("Total").previousSibling as HTMLElement;
    expect(total.textContent).toBe("6");
  });

  it("filters the runs passed to RunsTable when a filter button is clicked", async () => {
    const runs = [
      makeRun("r1", "Implementing"), // active
      makeRun("r2", "Done"), // done
    ];
    useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2");

    await userEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r1");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r2");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2");
  });

  it("opens the sync dialog when 'Sync from Linear' is clicked and closes it", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("close-dialog"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("shows the ingest summary banner after an ingest completes and allows manual dismissal", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    render(<DashboardPage />);

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await userEvent.click(screen.getByText("simulate-ingest"));

    expect(screen.getByTestId("ingest-banner").textContent).toContain("started=2");
    expect(screen.getByTestId("ingest-banner").textContent).toContain("skipped=1");

    await userEvent.click(screen.getByText("dismiss-banner"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await user.click(screen.getByText("simulate-ingest"));

    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
